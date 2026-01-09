import * as THREE from 'three';
import { TextureInfo, PackedTexture, AtlasNode } from './types';

export interface AtlasCache {
	atlasImageData: string; // Base64 encoded image data
	uvMap: Record<string, { u: number; v: number; width: number; height: number }>;
	packingEfficiency: number;
	timestamp: number;
	resourcePackHash: string;
	textureCount: number;
}

export class AtlasBuilder {
	private atlasSize: number;
	private padding: number;
	
	constructor(atlasSize: number = 2048, padding: number = 1) {
		this.atlasSize = atlasSize;
		this.padding = padding;
	}

	/**
	 * Build texture atlas with caching support
	 */
	public async buildAtlas(
		textures: { path: string; image: HTMLImageElement }[],
		cacheKey?: string
	): Promise<{
		atlas: HTMLCanvasElement;
		uvMap: Map<string, { u: number; v: number; width: number; height: number }>;
		packingEfficiency: number;
		fromCache: boolean;
	}> {
		console.log(`🔧 Starting atlas building with ${textures.length} textures`);
		
		// Try to load from cache first if cache key provided
		if (cacheKey) {
			const cachedResult = await this.loadFromCache(cacheKey, textures.length);
			if (cachedResult) {
				console.log(`✅ Loaded atlas from cache`);
				return { ...cachedResult, fromCache: true };
			}
		}

		// If no textures provided and no cache hit, this was just a cache check
		if (textures.length === 0) {
			throw new Error("No cache found and no textures provided");
		}

		// Build new atlas
		const result = await this.buildNewAtlas(textures);
		
		// Save to cache if cache key provided
		if (cacheKey) {
			await this.saveToCache(cacheKey, result, textures.length);
			console.log(`💾 Saved atlas to cache`);
		}

		return { ...result, fromCache: false };
	}

	/**
	 * Try to load atlas from cache
	 */
	private async loadFromCache(
		cacheKey: string, 
		expectedTextureCount: number
	): Promise<{
		atlas: HTMLCanvasElement;
		uvMap: Map<string, { u: number; v: number; width: number; height: number }>;
		packingEfficiency: number;
	} | null> {
		try {
			const cached = localStorage.getItem(`atlas_${cacheKey}`);
			if (!cached) return null;

			const cacheData: AtlasCache = JSON.parse(cached);
			
			// Validate cache - only check texture count if we actually have textures to compare
			if (expectedTextureCount > 0 && cacheData.textureCount !== expectedTextureCount) {
				console.log(`⚠️ Cache texture count mismatch: expected ${expectedTextureCount}, got ${cacheData.textureCount}`);
				return null;
			}

			// Check if cache is too old (1 week)
			const maxAge = 7 * 24 * 60 * 60 * 1000; // 1 week in ms
			if (Date.now() - cacheData.timestamp > maxAge) {
				console.log(`⚠️ Cache expired`);
				localStorage.removeItem(`atlas_${cacheKey}`);
				return null;
			}

			// Reconstruct atlas canvas from cached image data
			const canvas = document.createElement('canvas');
			canvas.width = this.atlasSize;
			canvas.height = this.atlasSize;
			const ctx = canvas.getContext('2d')!;

			const img = new Image();
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error('Failed to load cached image'));
				img.src = cacheData.atlasImageData;
			});

			ctx.drawImage(img, 0, 0);

			// Reconstruct UV map
			const uvMap = new Map<string, { u: number; v: number; width: number; height: number }>();
			Object.entries(cacheData.uvMap).forEach(([path, uv]) => {
				uvMap.set(path, uv);
			});

			console.log(`📊 Cache hit: ${uvMap.size} textures, ${cacheData.packingEfficiency.toFixed(1)}% efficiency`);

			return {
				atlas: canvas,
				uvMap,
				packingEfficiency: cacheData.packingEfficiency
			};

		} catch (error) {
			console.warn(`⚠️ Failed to load from cache:`, error);
			// Clean up corrupted cache
			localStorage.removeItem(`atlas_${cacheKey}`);
			return null;
		}
	}

	/**
	 * Save atlas to cache
	 */
	private async saveToCache(
		cacheKey: string,
		result: {
			atlas: HTMLCanvasElement;
			uvMap: Map<string, { u: number; v: number; width: number; height: number }>;
			packingEfficiency: number;
		},
		textureCount: number
	): Promise<void> {
		try {
			// Convert canvas to base64
			const atlasImageData = result.atlas.toDataURL('image/png');

			// Convert map to plain object
			const uvMapObject: Record<string, { u: number; v: number; width: number; height: number }> = {};
			result.uvMap.forEach((value, key) => {
				uvMapObject[key] = value;
			});

			const cacheData: AtlasCache = {
				atlasImageData,
				uvMap: uvMapObject,
				packingEfficiency: result.packingEfficiency,
				timestamp: Date.now(),
				resourcePackHash: cacheKey,
				textureCount
			};

			// Check storage size before saving
			const dataSize = JSON.stringify(cacheData).length;
			const maxSize = 5 * 1024 * 1024; // 5MB limit for localStorage
			
			if (dataSize > maxSize) {
				console.warn(`⚠️ Atlas cache too large (${(dataSize / 1024 / 1024).toFixed(1)}MB), skipping cache`);
				return;
			}

			localStorage.setItem(`atlas_${cacheKey}`, JSON.stringify(cacheData));
			console.log(`💾 Cached atlas: ${(dataSize / 1024).toFixed(1)}KB`);

		} catch (error) {
			console.warn(`⚠️ Failed to save to cache:`, error);
		}
	}

	/**
	 * Build a new atlas (original logic)
	 */
	private async buildNewAtlas(
		textures: { path: string; image: HTMLImageElement }[]
	): Promise<{
		atlas: HTMLCanvasElement;
		uvMap: Map<string, { u: number; v: number; width: number; height: number }>;
		packingEfficiency: number;
	}> {
		// Prepare texture info with dimensions
		const textureInfos: TextureInfo[] = textures.map(({ path, image }) => ({
			path,
			image,
			width: image.width,
			height: image.height,
			area: image.width * image.height
		}));

		// Sort textures for packing
		const sortedTextures = this.sortTexturesForPacking(textureInfos);

		// Try different packing strategies and pick the best one
		const packingResults = await Promise.all([
			this.packWithStrategy(sortedTextures, 'largest-first'),
			this.packWithStrategy(sortedTextures, 'area-first'),
			this.packWithStrategy(sortedTextures, 'height-first'),
			this.packWithStrategy(sortedTextures, 'width-first'),
			this.packWithStrategy(sortedTextures, 'perimeter-first')
		]);

		// Select the best packing result
		const bestResult = packingResults.reduce((best, current) => 
			current.efficiency > best.efficiency ? current : best
		);

		console.log(`📊 Best packing strategy: ${bestResult.strategy} with ${bestResult.efficiency.toFixed(1)}% efficiency`);
		console.log(`📦 Packed ${bestResult.packedTextures.length}/${textures.length} textures`);

		// Create the final atlas
		const { canvas, uvMap } = this.createAtlasCanvas(bestResult.packedTextures);

		return {
			atlas: canvas,
			uvMap,
			packingEfficiency: bestResult.efficiency
		};
	}

	/**
	 * Clear all atlas caches
	 */
	public static clearAllCaches(): void {
		const keys = Object.keys(localStorage);
		const atlasKeys = keys.filter(key => key.startsWith('atlas_'));
		
		atlasKeys.forEach(key => {
			localStorage.removeItem(key);
		});
		
		console.log(`🗑️ Cleared ${atlasKeys.length} atlas caches`);
	}

	/**
	 * Get cache info for debugging
	 */
	public static getCacheInfo(): { key: string; size: string; age: string; textureCount: number }[] {
		const keys = Object.keys(localStorage);
		const atlasKeys = keys.filter(key => key.startsWith('atlas_'));
		
		return atlasKeys.map(key => {
			try {
				const data = JSON.parse(localStorage.getItem(key) || '{}');
				const size = localStorage.getItem(key)?.length || 0;
				const age = Math.round((Date.now() - (data.timestamp || 0)) / (1000 * 60 * 60)); // hours
				
				return {
					key: key.replace('atlas_', ''),
					size: `${(size / 1024).toFixed(1)}KB`,
					age: `${age}h`,
					textureCount: data.textureCount || 0
				};
			} catch {
				return {
					key: key.replace('atlas_', ''),
					size: 'corrupted',
					age: 'unknown',
					textureCount: 0
				};
			}
		});
	}

	// Rest of the original methods remain the same...
	private sortTexturesForPacking(textures: TextureInfo[]): Record<string, TextureInfo[]> {
		return {
			'largest-first': [...textures].sort((a, b) => {
				const aMax = Math.max(a.width, a.height);
				const bMax = Math.max(b.width, b.height);
				if (bMax !== aMax) return bMax - aMax;
				return b.area - a.area;
			}),
			'area-first': [...textures].sort((a, b) => b.area - a.area),
			'height-first': [...textures].sort((a, b) => {
				if (b.height !== a.height) return b.height - a.height;
				return b.width - a.width;
			}),
			'width-first': [...textures].sort((a, b) => {
				if (b.width !== a.width) return b.width - a.width;
				return b.height - a.height;
			}),
			'perimeter-first': [...textures].sort((a, b) => (b.width + b.height) - (a.width + a.height))
		};
	}

	private async packWithStrategy(
		sortedTextures: Record<string, TextureInfo[]>, 
		strategy: string
	): Promise<{
		strategy: string;
		packedTextures: PackedTexture[];
		efficiency: number;
	}> {
		const textures = sortedTextures[strategy];
		const packedTextures = this.packTextures(textures);
		const efficiency = this.calculatePackingEfficiency(packedTextures);

		return {
			strategy,
			packedTextures,
			efficiency
		};
	}

	private packTextures(textures: TextureInfo[]): PackedTexture[] {
		const root: AtlasNode = {
			x: 0,
			y: 0,
			width: this.atlasSize,
			height: this.atlasSize,
			used: false
		};

		const packedTextures: PackedTexture[] = [];

		for (const texture of textures) {
			const node = this.findNode(root, texture.width + this.padding, texture.height + this.padding);
			
			if (node) {
				const fit = this.splitNode(node, texture.width + this.padding, texture.height + this.padding);
				packedTextures.push({
					...texture,
					x: fit.x,
					y: fit.y
				});
			} else {
				console.warn(`❌ Could not fit texture: ${texture.path} (${texture.width}x${texture.height})`);
			}
		}

		return packedTextures;
	}

	private findNode(root: AtlasNode, width: number, height: number): AtlasNode | null {
		if (root.used) {
			return this.findNode(root.right!, width, height) || 
				   this.findNode(root.down!, width, height);
		} else if (width <= root.width && height <= root.height) {
			return root;
		} else {
			return null;
		}
	}

	private splitNode(node: AtlasNode, width: number, height: number): AtlasNode {
		node.used = true;

		node.down = {
			x: node.x,
			y: node.y + height,
			width: node.width,
			height: node.height - height,
			used: false
		};

		node.right = {
			x: node.x + width,
			y: node.y,
			width: node.width - width,
			height: height,
			used: false
		};

		return node;
	}

	private calculatePackingEfficiency(packedTextures: PackedTexture[]): number {
		const totalTextureArea = packedTextures.reduce((sum, tex) => sum + tex.area, 0);
		const atlasArea = this.atlasSize * this.atlasSize;
		return (totalTextureArea / atlasArea) * 100;
	}

	private createAtlasCanvas(packedTextures: PackedTexture[]): {
		canvas: HTMLCanvasElement;
		uvMap: Map<string, { u: number; v: number; width: number; height: number }>;
	} {
		const canvas = document.createElement('canvas');
		canvas.width = this.atlasSize;
		canvas.height = this.atlasSize;
		
		const ctx = canvas.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, this.atlasSize, this.atlasSize);
		
		const uvMap = new Map<string, { u: number; v: number; width: number; height: number }>();

		for (const texture of packedTextures) {
			ctx.drawImage(texture.image, texture.x, texture.y);
			
			const u = texture.x / this.atlasSize;
			const v = texture.y / this.atlasSize;
			const width = texture.width / this.atlasSize;
			const height = texture.height / this.atlasSize;
			
			uvMap.set(texture.path, { u, v, width, height });
		}

		return { canvas, uvMap };
	}

	public visualizePacking(packedTextures: PackedTexture[]): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvas.width = this.atlasSize;
		canvas.height = this.atlasSize;
		
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'rgba(200, 200, 200, 0.3)';
		ctx.fillRect(0, 0, this.atlasSize, this.atlasSize);
		
		packedTextures.forEach((texture, index) => {
			const hue = (index * 137.508) % 360;
			ctx.strokeStyle = `hsl(${hue}, 70%, 50%)`;
			ctx.lineWidth = 1;
			ctx.strokeRect(texture.x, texture.y, texture.width, texture.height);
			
			if (texture.width > 50 && texture.height > 20) {
				ctx.fillStyle = `hsl(${hue}, 70%, 30%)`;
				ctx.font = '10px monospace';
				ctx.fillText(
					texture.path.split('/').pop() || texture.path, 
					texture.x + 2, 
					texture.y + 12
				);
			}
		});
		
		return canvas;
	}
}