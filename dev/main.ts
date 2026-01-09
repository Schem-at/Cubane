import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Cubane, ResourcePackLoadOptions } from "../src/index"; // Adjust path if necessary
import {
	createAxesHelper,
	getGridHelper,
	getSceneLights,
} from "./SceneHelpers"; // Adjust path if necessary
let isDragging = false;
let mouseDownTime = 0;
let mouseDownPosition = new THREE.Vector2();
const CLICK_THRESHOLD_MS = 200; // Max duration for a click (milliseconds)
const DRAG_THRESHOLD_PX = 5; // Max mouse movement for a click (pixels)

// Initialize the scene
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
	75,
	window.innerWidth / window.innerHeight,
	0.1,
	1000
);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;

// Setup controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Initialize Cubane
const cubane = new Cubane();

// Set up scene
let debug = false; // Set to true if you want debug mode on by default
let gridHelper: THREE.Group;
let axesHelper: THREE.Group;

// Setup camera
camera.position.set(10, 8, 10);
camera.lookAt(0, 0, 0);

// Block management
type BlockData = {
	id: string;
	blockString: string;
	position: THREE.Vector3;
	mesh: THREE.Object3D;
};

const blocks: BlockData[] = [];
let selectedBlockId: string | null = null;
let placementMode: "add" | "move" | "delete" = "add";

const GRID_SIZE = 1;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const planeGeometry = new THREE.PlaneGeometry(1000, 1000);
const planeMaterial = new THREE.MeshBasicMaterial({
	visible: false,
	side: THREE.DoubleSide,
});
const groundPlane = new THREE.Mesh(planeGeometry, planeMaterial);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.y = 0;
scene.add(groundPlane);
groundPlane.name = "GroundPlane";

let previewMesh: THREE.Object3D | null = null;

// Update scene based on debug mode
function updateDebugMode() {
	const checkbox = document.getElementById("debugMode") as HTMLInputElement;
	debug = checkbox ? checkbox.checked : false;

	if (gridHelper) scene.remove(gridHelper);
	if (axesHelper) scene.remove(axesHelper);

	// Create grid helper (always visible, detail might change with debug)
	if (debug) {
		// Example: More detailed grid for debug (adjust getGridHelper if needed)
		gridHelper = getGridHelper(GRID_SIZE * 16, GRID_SIZE / 2); // Smaller divisions
	} else {
		gridHelper = getGridHelper(GRID_SIZE * 16, GRID_SIZE);
	}
	scene.add(gridHelper);
	gridHelper.visible = true; // Make sure grid is always visible

	if (debug) {
		axesHelper = createAxesHelper(5);
		scene.add(axesHelper);
	}
}

// Initialize the scene with lights
function initScene() {
	// scene.background = new THREE.Color(0x87ceeb); // Sky blue background
	scene.background = new THREE.Color(0x222222); // Dark grey background
	scene.add(getSceneLights());
	updateDebugMode(); // Call to set initial grid and debug state
}

function updateStatus(message: string) {
	const statusElement = document.getElementById("status");
	if (statusElement) statusElement.textContent = message;
}

function updateBlockList() {
	const blockListItems = document.getElementById("blockListItems");
	if (!blockListItems) return;
	blockListItems.innerHTML = "";

	if (blocks.length === 0) {
		blockListItems.innerHTML = "<p>No blocks placed</p>";
		return;
	}

	blocks.forEach((block) => {
		const item = document.createElement("div");
		item.className = `block-item ${
			block.id === selectedBlockId ? "active" : ""
		}`;
		const pos = block.position;
		item.innerHTML = `
      <span>${block.blockString}<br>
      <small>Pos: ${pos.x}, ${pos.y}, ${pos.z}</small></span>
      <button class="delete-block" data-id="${block.id}">×</button>
    `;
		item.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).classList.contains("delete-block")) return;
			selectBlock(block.id);
		});
		blockListItems.appendChild(item);
	});

	document.querySelectorAll(".delete-block").forEach((button) => {
		button.addEventListener("click", () => {
			const id = (button as HTMLElement).getAttribute("data-id");
			if (id) removeBlock(id);
		});
	});
}

const HIGHLIGHT_COLOR = new THREE.Color(0xffaa00);

function selectBlock(id: string | null) {
	if (selectedBlockId === id) return;

	if (selectedBlockId) {
		const oldBlock = blocks.find((b) => b.id === selectedBlockId);
		if (oldBlock) applyHighlight(oldBlock.mesh, false);
	}

	selectedBlockId = id;

	if (selectedBlockId) {
		const newBlock = blocks.find((b) => b.id === selectedBlockId);
		if (newBlock) applyHighlight(newBlock.mesh, true);
	}
	updateBlockList();
}

function removeBlock(id: string) {
	const index = blocks.findIndex((b) => b.id === id);
	if (index !== -1) {
		const block = blocks[index];
		scene.remove(block.mesh);
		block.mesh.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				(Array.isArray(child.material)
					? child.material
					: [child.material]
				).forEach((m) => m.dispose());
			}
		});
		blocks.splice(index, 1);
		if (selectedBlockId === id) {
			selectBlock(null);
		}
		updateStatus(`Removed ${block.blockString}`);
		updateBlockList();
	}
}

function moveBlock(id: string, newPosition: THREE.Vector3) {
	const block = blocks.find((b) => b.id === id);
	if (block) {
		block.position.copy(newPosition);
		block.mesh.position.copy(newPosition);
		updateStatus(
			`Moved ${block.blockString} to ${newPosition.x}, ${newPosition.y}, ${newPosition.z}`
		);
		updateBlockList();
	}
}

function clearAllBlocks() {
	blocks.forEach((block) => {
		scene.remove(block.mesh);
		block.mesh.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				(Array.isArray(child.material)
					? child.material
					: [child.material]
				).forEach((m) => m.dispose());
			}
		});
	});
	blocks.length = 0;
	selectBlock(null);
	updateStatus("Cleared all blocks");
	updateBlockList();
}

function calculatePlacementPosition(
	intersection: THREE.Intersection
): THREE.Vector3 | null {
	if (!intersection.face) {
		console.warn("calculatePlacementPosition: Intersection has no face.");
		return null;
	}

	let placementPos: THREE.Vector3;

	if (intersection.object === groundPlane) {
		placementPos = intersection.point.clone();
		placementPos.x = Math.floor(intersection.point.x / GRID_SIZE) * GRID_SIZE;
		placementPos.y = 0;
		placementPos.z = Math.floor(intersection.point.z / GRID_SIZE) * GRID_SIZE;
	} else {
		const blockId = intersection.object.userData.blockId;
		const targetBlock = blocks.find((b) => b.id === blockId);

		if (targetBlock) {
			const offset = intersection.face.normal.clone().multiplyScalar(GRID_SIZE);
			placementPos = targetBlock.position.clone().add(offset);
		} else {
			console.warn(
				"calculatePlacementPosition: Intersected a non-ground object but could not find its BlockData. Object:",
				intersection.object
			);
			return null;
		}
	}

	const finalPos = new THREE.Vector3(
		Math.round(placementPos.x),
		Math.round(placementPos.y),
		Math.round(placementPos.z)
	);
	return finalPos;
}

async function loadResourcePackFromFile(file: File) {
	try {
		updateStatus("Loading resource pack...");
		const packId = `cubane_pack_${file.name.replace(/\W/g, "_")}`;
		const options: ResourcePackLoadOptions = {
			packId,
			useCache: true,
			forceReload: false,
		};
		await cubane.loadResourcePack(options, () => {
			updateStatus("Processing resource pack...");
			return file;
		});
		const loadedFromCache = cubane.lastPackLoadedFromCache;
		updateStatus(
			`Resource pack ${
				loadedFromCache ? "loaded from cache" : "processed and cached"
			} successfully!`
		);
		const packStatusElement = document.getElementById("packStatus");
		if (packStatusElement) {
			packStatusElement.textContent = `Loaded: ${file.name} ${
				loadedFromCache ? "(from cache)" : ""
			}`;
		}
		updatePreviewMesh();
	} catch (error) {
		updateStatus(`Error loading resource pack: ${error}`);
		console.error(error);
	}
}

// Add this helper function with better debugging
function cloneMeshMaterials(mesh) {
	mesh.traverse((child) => {
		if (child instanceof THREE.Mesh && child.material) {
			if (Array.isArray(child.material)) {
				child.material = child.material.map((mat) => {
					const cloned = mat.clone();
					// Copy all transparency-related properties explicitly
					cloned.transparent = mat.transparent;
					cloned.alphaTest = mat.alphaTest;
					cloned.depthWrite = mat.depthWrite;
					cloned.opacity = mat.opacity;
					cloned.side = mat.side;
					// Copy userData
					cloned.userData = { ...mat.userData };
					return cloned;
				});
			} else {
				const cloned = child.material.clone();
				// Copy all transparency-related properties explicitly
				cloned.transparent = child.material.transparent;
				cloned.alphaTest = child.material.alphaTest;
				cloned.depthWrite = child.material.depthWrite;
				cloned.opacity = child.material.opacity;
				cloned.side = child.material.side;
				// Copy userData
				cloned.userData = { ...child.material.userData };
				child.material = cloned;
			}
		}
	});
	return mesh;
}

async function updatePreviewMesh() {
	if (previewMesh) {
		scene.remove(previewMesh);
		previewMesh = null;
	}

	if (placementMode === "add") {
		const blockInput = document.getElementById(
			"blockInput"
		) as HTMLInputElement;
		if (!blockInput || !blockInput.value.trim()) return;

		try {
			const blockString = blockInput.value.trim();
			const tempPreviewMesh = await cubane.getBlockMesh(blockString);
			if (!tempPreviewMesh) return;

			// Clone the mesh and its materials to avoid affecting other blocks
			previewMesh = tempPreviewMesh.clone();
			cloneMeshMaterials(previewMesh);

			// Apply simple preview effects - just transparency and glow
			previewMesh.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					const materials = Array.isArray(child.material)
						? child.material
						: [child.material];
					materials.forEach((mat) => {
						// Store original properties for restoration
						mat.userData.isPreviewMaterial = true;
						mat.userData.originalOpacity = mat.opacity;

						// Apply preview effects
						mat.opacity = 0.6; // Semi-transparent preview
						if (mat instanceof THREE.MeshStandardMaterial) {
							mat.userData.originalEmissive = mat.emissive.clone();
							mat.emissive.setHex(0x111111); // Slight glow
						}
					});
				}
			});

			scene.add(previewMesh);
			previewMesh.visible = false;
		} catch (error) {
			console.warn(
				"Error creating preview mesh for '" + blockString + "':",
				error
			);
		}
	}
}

async function addBlock(blockString: string, position: THREE.Vector3) {
	if (!blockString) {
		updateStatus("Error: Block string cannot be empty.");
		return null;
	}
	try {
		const originalMesh = await cubane.getBlockMesh(blockString);
		if (!originalMesh) {
			updateStatus(`Error: Cubane returned no mesh for "${blockString}"`);
			return null;
		}

		// Clone the mesh and materials to ensure independence from preview and other blocks
		const mesh = originalMesh.clone();
		cloneMeshMaterials(mesh);



		// Only restore preview-specific properties, keep PNG transparency intact
		mesh.traverse((child) => {
			if (child instanceof THREE.Mesh && child.material) {
				const materials = Array.isArray(child.material)
					? child.material
					: [child.material];
				materials.forEach((mat) => {
					if (mat instanceof THREE.MeshStandardMaterial) {
						// Only reset emissive glow (preview effect)
						mat.emissive.setHex(0x000000);

						// Restore original opacity if this was a preview material
						if (mat.userData.isPreviewMaterial) {
							console.log(
								`Restoring preview material, originalOpacity: ${mat.userData.originalOpacity}`
							);
							mat.opacity = mat.userData.originalOpacity || 1.0;
							// Clean up preview flags
							delete mat.userData.isPreviewMaterial;
							delete mat.userData.originalOpacity;
							delete mat.userData.originalEmissive;
						}

						// Force material update
						mat.needsUpdate = true;
					}
				});
			}
		});

	

		mesh.position.copy(position);

		const id = `block_${Date.now()}_${Math.random()
			.toString(36)
			.substring(2, 7)}`;
		mesh.userData.blockId = id;
		mesh.traverse((child) => {
			child.userData.blockId = id;
		});

		const blockData: BlockData = {
			id,
			blockString,
			position: position.clone(),
			mesh,
		};
		blocks.push(blockData);
		scene.add(mesh);

		updateStatus(
			`Added ${blockString} at ${position.x}, ${position.y}, ${position.z}`
		);
		updateBlockList();
		selectBlock(id);
		return id;
	} catch (error) {
		updateStatus(`Error adding block "${blockString}": ${error}`);
		console.error(`Full error adding block "${blockString}":`, error);
		return null;
	}
}
function applyHighlight(object: THREE.Object3D, highlight: boolean) {
	object.traverse((child) => {
		if (child instanceof THREE.Mesh && child.material) {
			const materials = Array.isArray(child.material)
				? child.material
				: [child.material];
			materials.forEach((mat) => {
				if (mat instanceof THREE.MeshStandardMaterial) {
					if (highlight) {
						// Store the original emissive color if not already stored
						if (child.userData.originalEmissive === undefined) {
							child.userData.originalEmissive = mat.emissive.clone();
						}
						mat.emissive.copy(HIGHLIGHT_COLOR);
					} else {
						// Restore the original emissive color
						if (child.userData.originalEmissive instanceof THREE.Color) {
							mat.emissive.copy(child.userData.originalEmissive);
							delete child.userData.originalEmissive;
						} else {
							mat.emissive.setHex(0x000000);
						}
					}
				}
			});
		}
	});
}

function updateMousePointer(event: MouseEvent) {
	mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
	mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);
}

function onMouseMove(event: MouseEvent) {
	if (event.target !== renderer.domElement) return;

	updateMousePointer(event);

	const objectsToIntersect = [groundPlane, ...blocks.map((b) => b.mesh)];
	const intersects = raycaster.intersectObjects(objectsToIntersect, true);

	if (placementMode === "add" && previewMesh) {
		if (intersects.length > 0) {
			const placementPos = calculatePlacementPosition(intersects[0]);
			if (placementPos) {
				previewMesh.position.copy(placementPos);
				previewMesh.visible = true;
			} else {
				previewMesh.visible = false;
			}
		} else {
			previewMesh.visible = false;
		}
	} else if (placementMode === "move" && selectedBlockId) {
		const blockToMove = blocks.find((b) => b.id === selectedBlockId);
		if (blockToMove) {
			const otherBlocks = blocks
				.filter((b) => b.id !== selectedBlockId)
				.map((b) => b.mesh);
			const moveIntersects = raycaster.intersectObjects(
				[groundPlane, ...otherBlocks],
				true
			);
			if (moveIntersects.length > 0) {
				const placementPos = calculatePlacementPosition(moveIntersects[0]);
				if (placementPos) {
					blockToMove.mesh.position.copy(placementPos);
				}
			}
		}
	}
}

function onMouseClick(event: MouseEvent) {
	if (event.target !== renderer.domElement) return;
	if (controls.state !== -1 && event.button === 0) return; // Allow right click for context menu if needed, but not main interaction if orbiting

	updateMousePointer(event);

	const blockMeshes = blocks.map((b) => b.mesh);
	const objectsToIntersect = [groundPlane, ...blockMeshes];
	const intersects = raycaster.intersectObjects(objectsToIntersect, true);

	if (placementMode === "add") {
		if (intersects.length > 0) {
			const placementPos = calculatePlacementPosition(intersects[0]);
			if (placementPos) {
				const blockInput = document.getElementById(
					"blockInput"
				) as HTMLInputElement;
				if (blockInput && blockInput.value.trim()) {
					addBlock(blockInput.value.trim(), placementPos);
				} else {
					updateStatus("Enter a block name to add.");
				}
			}
		}
	} else if (placementMode === "move" && selectedBlockId) {
		const blockToMove = blocks.find((b) => b.id === selectedBlockId);
		if (blockToMove) {
			moveBlock(selectedBlockId, blockToMove.mesh.position.clone());
		}
	} else if (placementMode === "delete") {
		const deleteIntersects = raycaster.intersectObjects(blockMeshes, true);
		if (deleteIntersects.length > 0) {
			const clickedObject = deleteIntersects[0].object;
			const blockId = clickedObject.userData.blockId;
			if (blockId) {
				removeBlock(blockId);
			}
		}
	} else {
		const selectIntersects = raycaster.intersectObjects(blockMeshes, true);
		if (selectIntersects.length > 0) {
			const clickedObject = selectIntersects[0].object;
			const blockId = clickedObject.userData.blockId;
			if (blockId) {
				selectBlock(blockId);
			}
		} else {
			selectBlock(null);
		}
	}
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
	requestAnimationFrame(animate);
	controls.update();
	cubane.updateAnimations();
	renderer.render(scene, camera);
}

async function showPackManager() {
	const modal = document.getElementById("pack-manager");
	if (modal) modal.style.display = "block";
	await refreshPackList();
}

function hidePackManager() {
	const modal = document.getElementById("pack-manager");
	if (modal) modal.style.display = "none";
}

async function refreshPackList() {
	const availablePacks = document.getElementById("available-packs");
	if (!availablePacks) return;
	const packs = await cubane.listCachedResourcePacks();
	if (packs.length === 0) {
		availablePacks.innerHTML =
			"<p>No resource packs in cache. Upload one first.</p>";
		return;
	}
	const listElement = document.createElement("div");
	listElement.className = "pack-list";
	packs.forEach((pack) => {
		const item = document.createElement("div");
		item.className = "pack-item";
		item.dataset.id = pack.id;
		const date = new Date(pack.timestamp);
		const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
		const sizeMB = (pack.size / (1024 * 1024)).toFixed(2);
		item.innerHTML = `<div><strong>${pack.name}</strong><div class="pack-info">Size: ${sizeMB} MB • Added: ${dateStr}</div></div>`;
		item.addEventListener("click", () => {
			document
				.querySelectorAll(".pack-item.selected")
				.forEach((el) => el.classList.remove("selected"));
			item.classList.add("selected");
		});
		listElement.appendChild(item);
	});
	availablePacks.innerHTML = "";
	availablePacks.appendChild(listElement);
}

async function loadSelectedPack() {
	const selectedItem = document.querySelector(".pack-item.selected");
	if (!selectedItem) {
		alert("Please select a resource pack first");
		return;
	}
	const packId = (selectedItem as HTMLElement).dataset.id;
	if (!packId) return;
	updateStatus("Loading resource pack from cache...");
	const success = await cubane.loadCachedPack(packId);
	if (success) {
		updateStatus("Resource pack loaded successfully from cache!");
		const packName =
			selectedItem.querySelector("strong")?.textContent || "Pack";
		const packStatusElement = document.getElementById("packStatus");
		if (packStatusElement)
			packStatusElement.textContent = `Loaded: ${packName} (from cache)`;
		hidePackManager();
		updatePreviewMesh();
	} else {
		updateStatus("Failed to load resource pack from cache.");
	}
}

async function deleteSelectedPack() {
	const selectedItem = document.querySelector(".pack-item.selected");
	if (!selectedItem) {
		alert("Please select a resource pack first");
		return;
	}
	const packId = (selectedItem as HTMLElement).dataset.id;
	if (!packId) return;
	const packName =
		selectedItem.querySelector("strong")?.textContent || "this pack";
	if (confirm(`Are you sure you want to delete "${packName}" from cache?`)) {
		const success = await cubane.deleteCachedPack(packId);
		if (success) {
			updateStatus(`Deleted resource pack "${packName}" from cache`);
			await refreshPackList();
		} else {
			updateStatus("Failed to delete resource pack.");
		}
	}
}

async function tryLoadMostRecentPack() {
	updateStatus("Checking for cached resource packs...");
	const loaded = await cubane.loadMostRecentPack();
	if (loaded) {
		const packs = await cubane.listCachedResourcePacks();
		if (packs.length > 0) {
			const packName = packs[0].name;
			updateStatus(`Automatically loaded resource pack: ${packName}`);
			const packStatusElement = document.getElementById("packStatus");
			if (packStatusElement)
				packStatusElement.textContent = `Loaded: ${packName} (auto-loaded)`;
			return true;
		}
	} else {
		updateStatus(
			"No cached resource packs found. Please upload one or load from file."
		);
	}
	return false;
}

function updatePlacementMode(newMode: "add" | "move" | "delete") {
	placementMode = newMode;
	document
		.querySelectorAll(".mode-select button")
		.forEach((btn) => btn.classList.remove("active"));
	document.getElementById(`${newMode}Mode`)?.classList.add("active");

	switch (newMode) {
		case "add":
			canvas.style.cursor = "crosshair";
			updatePreviewMesh();
			break;
		case "move":
			canvas.style.cursor = "move";
			if (previewMesh) {
				scene.remove(previewMesh);
				previewMesh = null;
			}
			if (!selectedBlockId && blocks.length > 0) {
				updateStatus("Select a block to move.");
			}
			break;
		case "delete":
			canvas.style.cursor = "not-allowed";
			if (previewMesh) {
				scene.remove(previewMesh);
				previewMesh = null;
			}
			break;
		default: // Should not happen with current modes
			canvas.style.cursor = "default";
			if (previewMesh) {
				scene.remove(previewMesh);
				previewMesh = null;
			}
			break;
	}
}

// Existing onMouseMove (now also handles drag detection)
function onCanvasMouseMove(event: MouseEvent) {
	// Changed parameter name to avoid conflict if you had onMouseMove elsewhere
	if (event.target !== renderer.domElement) return;

	// Drag detection logic
	if (mouseDownTime > 0) {
		// If mouse button is down (checked by mouseDownTime being set)
		const deltaX = Math.abs(event.clientX - mouseDownPosition.x);
		const deltaY = Math.abs(event.clientY - mouseDownPosition.y);
		if (
			!isDragging &&
			(deltaX > DRAG_THRESHOLD_PX || deltaY > DRAG_THRESHOLD_PX)
		) {
			isDragging = true;
			console.log("Drag detected"); // For debugging
			// Hide preview mesh when dragging starts
			if (previewMesh && placementMode === "add") {
				previewMesh.visible = false;
			}
		}
	}

	// Original onMouseMove logic to update preview, etc.
	// Only update preview if not dragging OR if it's part of move mode
	if (isDragging && placementMode === "add" && previewMesh) {
		if (previewMesh.visible) previewMesh.visible = false; // Keep it hidden during drag
		return; // Don't update preview position during a camera drag
	}

	updateMousePointer(event); // updateMousePointer needs event as MouseEvent

	const objectsToIntersect = [groundPlane, ...blocks.map((b) => b.mesh)];
	const intersects = raycaster.intersectObjects(objectsToIntersect, true);

	if (placementMode === "add" && previewMesh) {
		if (intersects.length > 0) {
			const placementPos = calculatePlacementPosition(intersects[0]);
			if (placementPos) {
				if (!previewMesh.visible) previewMesh.visible = true;
				previewMesh.position.copy(placementPos);
			} else {
				if (previewMesh.visible) previewMesh.visible = false;
			}
		} else {
			if (previewMesh.visible) previewMesh.visible = false;
		}
	} else if (placementMode === "move" && selectedBlockId) {
		// Moving a block should still allow its preview to follow the cursor
		const blockToMove = blocks.find((b) => b.id === selectedBlockId);
		if (blockToMove) {
			const otherBlocks = blocks
				.filter((b) => b.id !== selectedBlockId)
				.map((b) => b.mesh);
			const moveIntersects = raycaster.intersectObjects(
				[groundPlane, ...otherBlocks],
				true
			);
			if (moveIntersects.length > 0) {
				const placementPos = calculatePlacementPosition(moveIntersects[0]);
				if (placementPos) {
					blockToMove.mesh.position.copy(placementPos);
				}
			}
		}
	}
}

function onCanvasMouseDown(event: MouseEvent) {
	if (event.target !== renderer.domElement) return;
	// Only consider left mouse button for our click/drag logic for placement
	if (event.button !== 0) return;

	isDragging = false;
	mouseDownTime = Date.now();
	mouseDownPosition.set(event.clientX, event.clientY);
	// console.log("Mouse Down"); // For debugging

	// OrbitControls is already listening for mousedown.
	// We don't want to interfere with its start.
}

function onCanvasMouseUp(event: MouseEvent) {
	if (event.target !== renderer.domElement) return;
	// Only consider left mouse button
	if (event.button !== 0) return;

	// console.log("Mouse Up. isDragging:", isDragging, "Controls state:", controls.state); // For debugging

	const timeSinceMouseDown = Date.now() - mouseDownTime;

	// Important: Reset mouseDownTime immediately so onCanvasMouseMove stops drag detection for this press
	mouseDownTime = 0;

	// Check if OrbitControls was actively being used OR if our drag flag is set
	// OrbitControls.state: -1=NONE, 0=ROTATE, 1=DOLLY, 2=PAN
	// The `controls.state` might not have reset to -1 yet by the time 'mouseup' fires,
	// even if the user just finished a drag. So, `isDragging` is very important.
	if (isDragging) {
		// console.log("Drag finished, not a click."); // For debugging
		isDragging = false; // Reset our flag
		// After a drag, ensure the preview mesh is updated if in add mode
		if (placementMode === "add" && previewMesh) {
			onCanvasMouseMove(event); // Call mousemove to reposition/reshow preview
		}
		return;
	}

	// If it wasn't a drag by our definition, and it was short enough
	if (timeSinceMouseDown < CLICK_THRESHOLD_MS) {
		// AND OrbitControls wasn't in the middle of a camera operation initiated by another button/input
		// (though our event.button check should mostly handle this for left click)
		// A subtle point: if OrbitControls handles a very short drag as a click, it might also fire.
		// The line `if (controls.state !== -1 && event.button === 0) return;` in your original onMouseClick
		// was meant to prevent this. We can add a similar check here or in handleCanvasClick.

		// console.log("Click detected, time:", timeSinceMouseDown); // For debugging
		handleCanvasClickLogic(event); // Call your original click logic, renamed
	} else {
		// console.log("Long press, not a click, time:", timeSinceMouseDown); // For debugging
	}

	isDragging = false; // Reset our flag just in case
}

// Rename your existing onMouseClick to handleCanvasClickLogic
// This function will contain the core logic of what happens on a "valid" click.
function handleCanvasClickLogic(event: MouseEvent) {
	// Accepts MouseEvent
	// Your existing onMouseClick logic goes here, for example:
	// console.log("handleCanvasClickLogic executed"); // For debugging

	// Add this check here to be absolutely sure OrbitControls isn't overriding
	// This state check is more reliable *after* OrbitControls has processed mouseup.
	if (controls.enabled && controls.state !== -1 && event.button === 0) {
		// console.log("OrbitControls still active, deferring click.");
		return;
	}

	updateMousePointer(event); // Pass the MouseEvent

	const blockMeshes = blocks.map((b) => b.mesh);
	const objectsToIntersect = [groundPlane, ...blockMeshes];
	const intersects = raycaster.intersectObjects(objectsToIntersect, true);

	// ... (rest of your original onMouseClick logic for placement, move, delete, select)
	if (placementMode === "add") {
		if (intersects.length > 0) {
			const placementPos = calculatePlacementPosition(intersects[0]);
			if (placementPos) {
				const blockInput = document.getElementById(
					"blockInput"
				) as HTMLInputElement;
				if (blockInput && blockInput.value.trim()) {
					addBlock(blockInput.value.trim(), placementPos);
				} else {
					updateStatus("Enter a block name to add.");
				}
			}
		}
	} else if (placementMode === "move" && selectedBlockId) {
		const blockToMove = blocks.find((b) => b.id === selectedBlockId);
		if (blockToMove) {
			// Finalize move based on current mesh position (which was updated by mousemove)
			moveBlock(selectedBlockId, blockToMove.mesh.position.clone());
		}
	} else if (placementMode === "delete") {
		const deleteIntersects = raycaster.intersectObjects(blockMeshes, true);
		if (deleteIntersects.length > 0) {
			const clickedObject = deleteIntersects[0].object;
			const blockId = clickedObject.userData.blockId;
			if (blockId) {
				removeBlock(blockId);
			}
		}
	} else {
		// Default selection mode
		const selectIntersects = raycaster.intersectObjects(blockMeshes, true);
		if (selectIntersects.length > 0) {
			const clickedObject = selectIntersects[0].object;
			const blockId = clickedObject.userData.blockId;
			if (blockId) {
				selectBlock(blockId);
			}
		} else {
			selectBlock(null);
		}
	}
}

function setupEventListeners() {
	document.getElementById("loadResourcePack")?.addEventListener("click", () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".zip";
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (file) await loadResourcePackFromFile(file);
		};
		input.click();
	});

	document.getElementById("addBlockButton")?.addEventListener("click", () => {
		const blockInput = document.getElementById(
			"blockInput"
		) as HTMLInputElement;
		const blockString = blockInput?.value.trim();
		if (blockString && previewMesh && previewMesh.visible) {
			addBlock(blockString, previewMesh.position.clone());
		} else if (blockString) {
			addBlock(blockString, new THREE.Vector3(0, 0, 0));
			updateStatus(
				"Block added at default. Click on canvas to place precisely."
			);
		} else {
			updateStatus("Enter a block name and position preview on canvas to add.");
		}
	});

	document
		.getElementById("addMode")
		?.addEventListener("click", () => updatePlacementMode("add"));
	document
		.getElementById("moveMode")
		?.addEventListener("click", () => updatePlacementMode("move"));
	document
		.getElementById("deleteMode")
		?.addEventListener("click", () => updatePlacementMode("delete"));

	const blockInput = document.getElementById("blockInput") as HTMLInputElement;
	if (blockInput) blockInput.addEventListener("input", updatePreviewMesh);

	document.querySelectorAll(".preset-button").forEach((button) => {
		button.addEventListener("click", () => {
			const blockString = (button as HTMLElement).dataset.block;
			if (blockString && blockInput) {
				blockInput.value = blockString;
				updatePreviewMesh();
			}
		});
	});

	const debugModeCheckbox = document.getElementById(
		"debugMode"
	) as HTMLInputElement;
	if (debugModeCheckbox) {
		debugModeCheckbox.checked = debug; // Reflect initial debug state
		debugModeCheckbox.addEventListener("change", updateDebugMode);
	}

	document.getElementById("clearAll")?.addEventListener("click", () => {
		if (confirm("Are you sure you want to clear all blocks?")) clearAllBlocks();
	});

	canvas.addEventListener("mousemove", onMouseMove);
	// canvas.addEventListener("click", onMouseClick);
	canvas.addEventListener("mousedown", onCanvasMouseDown);
	canvas.addEventListener("mouseup", onCanvasMouseUp);
	canvas.addEventListener("mousemove", onCanvasMouseMove); // Your existing onMouseMove

	canvas.addEventListener("contextmenu", (event) => event.preventDefault());

	window.addEventListener("resize", onWindowResize);

	document
		.getElementById("manage-packs")
		?.addEventListener("click", showPackManager);
	document
		.getElementById("close-pack-manager")
		?.addEventListener("click", hidePackManager);
	document
		.querySelector("#pack-manager .close")
		?.addEventListener("click", hidePackManager);
	document
		.getElementById("load-selected-pack")
		?.addEventListener("click", loadSelectedPack);
	document
		.getElementById("delete-selected-pack")
		?.addEventListener("click", deleteSelectedPack);
}

async function init() {
	initScene(); // Calls updateDebugMode internally for initial grid
	setupEventListeners();
	updateBlockList();
	updatePlacementMode("add");

	await tryLoadMostRecentPack();
	updatePreviewMesh();

	animate();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}
