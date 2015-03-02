/*
	Javascript WebGL Globe Toolkit
	derived from http://dataarts.github.com/dat.globe
	adapted by Colin Cohen (pabitel)
	pabitel@yahoo.com
	donations: 1PSFuV3ii261Z74vS1FWTKrx7n1hB1yyik
	
	Licensed under the Apache License, Version 2.0 (the 'License');
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at
	http://www.apache.org/licenses/LICENSE-2.0
*/

var DAT = DAT || {};

DAT.Globe = function(container, opts) {
	opts = opts || {};
  
	var colorFn = opts.colorFn || function(x) {
		var c = new THREE.Color();
		c.setHSL( ( 0.6 - ( x * 0.5 ) ), 1.0, 0.5 );
		return c;
	};
	var imgDir = opts.imgDir || '/';

	// earth shaders
	var Shaders = {
		// background glow
		'atmosphere' : {
			uniforms: {},
			vertexShader: [
				'varying vec3 vNormal;',
				'void main() {',
					'vNormal = normalize( normalMatrix * normal );',
					'gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
				'}'
			].join('\n'),
			fragmentShader: [
				'varying vec3 vNormal;',
				'void main() {',
					'float intensity = pow( 0.8 - dot( vNormal, vec3( 0, 0, 1.0 ) ), 12.0 );',
					'gl_FragColor = vec4( 0.7, 0.7, 1.0, 1.0 ) * intensity;',
				'}'
			].join('\n')
		},
		// land masses
		'continents' : {
			uniforms: {},
			vertexShader: [
				'varying vec3 vNormal;',
				'void main() {',
					'vec4 pos = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
					'vNormal = normalize( normalMatrix * normalize( position ));',
					'gl_Position = pos;',
				'}'
			].join('\n'),
			fragmentShader: [
				'varying vec3 vNormal;',
				'void main() {',
					'float i = pow(clamp(dot( vNormal, normalize(vec3( 0.0, 2.0, 1.0 ))), 0.0, 1.0), 1.5);',
					'float i2 = 0.8-pow(clamp(dot( vNormal, normalize(vec3( 0.0, -0.0, 1.0 ))), 0.0, 1.0), 1.7);',
					'gl_FragColor = vec4(0.75, 0.75, 1, 0.9);',
					'gl_FragColor.a = 1.0;',
				'}'
			].join('\n')
		}
	};

	var camera, scene, renderer, w, h;
	var vector, mesh, atmosphere, point;

	var overRenderer;

	var curZoomSpeed = 0;

	var mouse = { x: 0, y: 0 }, mouseOnDown = { x: 0, y: 0 },
		mouseMoveRay = { x: 0, y: 0 }, mouseDownRay = { x: 0, y: 0 };
	var rotation = { x: 0, y: 0 },
		target = { x: Math.PI*3/2, y: Math.PI / 6.0 },
		targetOnDown = { x: 0, y: 0 };
		
	var distance = 100000, distanceTarget = 100000;
	var padding = 40;
	var PI_HALF = Math.PI / 2;
  
	var raycaster = new THREE.Raycaster();
	// location marker object
	var locations = new Locations();
	var loc = 0;
	var loaded = 0;
	var inModal = false;
  
	function init() {

		container.style.color = '#fff';
		container.style.font = '13px/20px Arial, sans-serif';

		w = container.offsetWidth || window.innerWidth;
		h = container.offsetHeight || window.innerHeight;

		camera = new THREE.PerspectiveCamera(30, w / h, 1, 10000);
		camera.position.z = distance;
	
		vector = new THREE.Vector3();

		scene = new THREE.Scene();

		var shader, uniforms, material;

		// create Earth sphere
		var sphereGeometry = new THREE.SphereGeometry(200, 80, 30);

		var material = new THREE.MeshBasicMaterial({color: 0x0B0012});

		mesh = new THREE.Mesh(sphereGeometry, material);
		mesh.matrixAutoUpdate = false;
		scene.add(mesh);
	
		// create glowing background
		shader = Shaders['atmosphere'];
		uniforms = THREE.UniformsUtils.clone(shader.uniforms);

		material = new THREE.ShaderMaterial( {
			uniforms: uniforms,
			vertexShader: shader.vertexShader,
			fragmentShader: shader.fragmentShader,
			side: THREE.BackSide,
			blending: THREE.AdditiveBlending,
			transparent: true
        } );

		mesh = new THREE.Mesh(sphereGeometry, material);
		mesh.scale.set( 1.1, 1.1, 1.1);
		scene.add(mesh);

		// create land masses

		shader = Shaders['continents'];
		uniforms = THREE.UniformsUtils.clone(shader.uniforms);

		material = new THREE.ShaderMaterial( {
			uniforms: uniforms,
			vertexShader: shader.vertexShader,
			fragmentShader: shader.fragmentShader
		} );
		scene.add(loadTriMesh(getWorld, material));
		
		renderer = new THREE.WebGLRenderer({antialias: true});
		renderer.setSize(w, h);

		renderer.domElement.style.position = 'absolute';

		container.addEventListener('mousedown', onMouseDown, false);

		container.addEventListener('mousewheel', onMouseWheel, false);
		container.addEventListener('DOMMouseScroll', onMouseWheel, false);

		document.addEventListener('keydown', onDocumentKeyDown, false);

		window.addEventListener('mousemove', onMouseMoveRay, false);
		window.addEventListener('mousedown', onMouseDownRay, false);
		window.addEventListener('resize', onWindowResize, false);

		container.addEventListener('mouseover', function() {
			overRenderer = true;
		}, false);

		container.addEventListener('mouseout', function() {
			overRenderer = false;
		}, false);
	}
  
	// load land masses
	function loadTriMesh(loader, material) {
		var coords = loader().children[0].children[0].attributes.Vertex.elements;
		var lineGeo = new THREE.Geometry();
		var i = 0;
		var lines = [];
		
		for (i=0; i<coords.length; i+=3) {
			lines.push(new THREE.Vector3(coords[i], coords[i+1], coords[i+2]));
		}
		// triangulate meshes
		lines = spherizeTris(lines, 1/64);
		
		for (i=0; i<lines.length; i++) {
			lineGeo.vertices.push(this.position = lines[i] || new THREE.Vector3());
		}
		for (i=0; i<lines.length; i+=3) {
			lineGeo.faces.push(new THREE.Face3(i, i+1, i+2, null, null));
		}
		
		var lineMesh = new THREE.Mesh(lineGeo, material);
		lineMesh.type = THREE.Triangles;
		lineMesh.scale.x = lineMesh.scale.y = lineMesh.scale.z = 0.0000315;
		lineMesh.rotation.x = -Math.PI/2;
		lineMesh.rotation.z = Math.PI;
		lineMesh.matrixAutoUpdate = false;
		lineMesh.doubleSided = true;
		lineMesh.updateMatrix();
		
		return lineMesh;
	}

	// add location markers and start animation
	function addData(data, records) {
		var img = 'http://dfeb7629b61b04aa78e60a98224f6e2583b793ad.googledrive.com/host/0B3TvHbZBlvFMRHhWaE9BZ1ZCVlk/' + data[9];
		locations.textures[loc] = new THREE.Texture();
		var texLoader = new THREE.ImageLoader();
		texLoader.crossOrigin = '';
		// on a texture being loaded
		locations.textures[loc].image = texLoader.load(img, function (obj) {
			loaded++;
			//on all textures being loaded
			if (loaded == records) {
				for (i = 0; i < locations.textures.length; i++) {
					locations.textures[i].needsUpdate = true;
					locations.textures[i].minFilter = THREE.LinearFilter;
					// add logo to location circle
					locations.materials[i] = new THREE.MeshBasicMaterial({map: locations.textures[i]});
					locations.materials[i].side = THREE.DoubleSide;
					var circleGeometry = new THREE.CircleGeometry(2.5, 24);
					// flip texture if necessary
					if (locations.lng[i] < 0) {
						flip(circleGeometry);
					}
					locations.meshes[i] = new THREE.Mesh(circleGeometry, locations.materials[i]);
					// add colored outline to circle
					var outline = new THREE.Mesh(circleGeometry, new THREE.MeshBasicMaterial({color: randomColor({luminosity: 'dark'}), 
													side: THREE.DoubleSide}));
					outline.scale.set( 1.15, 1.15, 1.15);
					locations.meshes[i].add(outline);
					outline.position.z += 0.1
					
					// compute location on globe
					var phi = (90 - locations.lat[i]) * Math.PI / 180;
					var theta = (180 - locations.lng[i]) * Math.PI / 180;
					var radius = 200;
					locations.meshes[i].position.x = (radius + 5) * Math.sin(phi) * Math.cos(theta);
					locations.meshes[i].position.y = (radius + 5) * Math.cos(phi);
					locations.meshes[i].position.z = (radius + 5) * Math.sin(phi) * Math.sin(theta);
					if (locations.lng[i] > 0) {
						locations.meshes[i].rotation.y -= 30 * Math.ceil(locations.lng[i]/45);
					}
					// add location circle
					scene.add(locations.meshes[i]);
					// store index for user selection
					locations.meshes[i].index = i;
				}
				// display renderer
				container.appendChild(renderer.domElement);
				// start animation
				animate();
			}
		});
		
		// load location data from charity JSON file
		locations.lat[loc] = data[3];
		locations.lng[loc] = data[4];
		locations.names[loc] = data[0];
		locations.addresses[loc] = data[1] + ", " + data[2];
		locations.sites[loc] = data[5];
		// locations.bitcoins[loc] = data[6];
		locations.descriptions[loc] = data[7];
		// locations.youtubes[loc] = data[8];
		locations.logos[loc] = img;
		loc++;
	}
  
	// flip texture
	function flip(geometry) {
		var m = (new THREE.Matrix4()).identity();
	
		m.elements[0] = -1;
		m.elements[10] = -1;
		geometry.applyMatrix(m);
	}

	// begin drag
	function onMouseDown(event) {
		event.preventDefault();

		container.addEventListener('mousemove', onMouseMove, false);
		container.addEventListener('mouseup', onMouseUp, false);
		container.addEventListener('mouseout', onMouseOut, false);

		mouseOnDown.x = - event.clientX;
		mouseOnDown.y = event.clientY;

		targetOnDown.x = target.x;
		targetOnDown.y = target.y;

		container.style.cursor = 'move';
	}

	// drag
	function onMouseMove(event) {
		mouse.x = - event.clientX;
		mouse.y = event.clientY;
	
		var zoomDamp = distance/1000;

		target.x = targetOnDown.x + (mouse.x - mouseOnDown.x) * 0.005 * zoomDamp;
		target.y = targetOnDown.y + (mouse.y - mouseOnDown.y) * 0.005 * zoomDamp;

		target.y = target.y > PI_HALF ? PI_HALF : target.y;
		target.y = target.y < - PI_HALF ? - PI_HALF : target.y;
	}

	// check for mouse over location circle
	function onMouseMoveRay(event) {
		mouseMoveRay.x = (event.clientX / window.innerWidth) * 2 - 1;
		mouseMoveRay.y = -(event.clientY / window.innerHeight) * 2 + 1;
	
		raycaster.setFromCamera(mouseMoveRay, camera);
		var intersects = raycaster.intersectObjects(locations.meshes);
		if (intersects.length > 0) {
			container.style.cursor = 'pointer';
		}
		else {
			container.style.cursor = 'auto';
		}
	}
  
	// check for clicking location circle
	function onMouseDownRay(event) {
		mouseMoveRay.x = (event.clientX / window.innerWidth) * 2 - 1;
		mouseMoveRay.y = -(event.clientY / window.innerHeight) * 2 + 1;
	
		raycaster.setFromCamera(mouseMoveRay, camera);
		var intersects = raycaster.intersectObjects(locations.meshes);
		if (intersects.length > 0) {
			// stop checking for mouse click while modal dialog active
			window.removeEventListener('mousedown', onMouseDownRay, false);
			inModal = true;
			// open info dialog
			Modal.open({width: '50%', 
					content: "<img style='max-height: 50px; width: auto;' src='" + locations.logos[intersects[0].object.index] + "'/>" +
								"<p><b>" + locations.names[intersects[0].object.index].toUpperCase() + "</b></p>" +
								"<p>" + locations.addresses[intersects[0].object.index] + "</p>" +
								"<p><a href='" + locations.sites[intersects[0].object.index] + "'>" +
								locations.sites[intersects[0].object.index] + "</a></p>" +
								/*"<p><a href='bitcoin:" + locations.bitcoins[intersects[0].object.index] + "'>" +
								locations.bitcoins[intersects[0].object.index] + "</a></p>" +*/
								locations.descriptions[intersects[0].object.index],
					// again check for mouse clicks
					closeCallback: function () {
						window.addEventListener('mousedown', onMouseDownRay, false);
						inModal = false;
					}
			} );
		}
	}
    
	// stop dragging
	function onMouseUp(event) {
		container.removeEventListener('mousemove', onMouseMove, false);
		container.removeEventListener('mouseup', onMouseUp, false);
		container.removeEventListener('mouseout', onMouseOut, false);
		container.style.cursor = 'auto';
	}

	// mouse leaves scene
	function onMouseOut(event) {
		container.removeEventListener('mousemove', onMouseMove, false);
		container.removeEventListener('mouseup', onMouseUp, false);
		container.removeEventListener('mouseout', onMouseOut, false);
	}

	// zoom or pinch
	function onMouseWheel(event) {
		// WebKit version
		if (event.wheelDeltaY) {
			camera.fov -= event.wheelDeltaY * 0.1;
		// Opera/Explorer 9 version
		} else if (event.wheelDelta) {
			camera.fov += event.wheelDelta * 0.1;
		// Firefox version
		} else if ( event.detail ) {
			camera.fov += event.detail * 0.3;
		}
		camera.updateProjectionMatrix();
		
		return false;
	}

	// keyboard zoom
	function onDocumentKeyDown(event) {
		switch (event.keyCode) {
			case 38:
				zoom(100);
				event.preventDefault();
				break;
			case 40:
				zoom(-100);
				event.preventDefault();
				break;
		}
	}

	function onWindowResize(event) {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );
	}

	// zoom in globe at start of animation
	function zoom(delta) {
		distanceTarget -= delta;
		distanceTarget = distanceTarget > 1000 ? 1000 : distanceTarget;
		distanceTarget = distanceTarget < 350 ? 350 : distanceTarget;
	}

	// start animation loop
	function animate() {
		requestAnimationFrame(animate);
		render();
	}

	// render scene
	function render() {
		// don't render if dialog open
		if (inModal)
			return;
			
		// globe animation
		zoom(curZoomSpeed);
					
		rotation.x += (target.x - rotation.x) * 0.1;
		rotation.y += (target.y - rotation.y) * 0.1;
		distance += (distanceTarget - distance) * 0.3;

		camera.position.x = distance * Math.sin(rotation.x) * Math.cos(rotation.y);
		camera.position.y = distance * Math.sin(rotation.y);
		camera.position.z = distance * Math.cos(rotation.x) * Math.cos(rotation.y);

		camera.lookAt(mesh.position);

		renderer.render(scene, camera);	
	}

	init();
	
	this.animate = animate;
	this.addData = addData;
	this.renderer = renderer;
	this.scene = scene;

	return this;
};