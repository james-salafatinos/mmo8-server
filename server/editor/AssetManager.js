// AssetManager - handles server-side asset library
import { readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class AssetManager {
    constructor() {
        // Asset directory path
        this.assetsPath = join(__dirname, '../../assets');
        
        // Supported asset extensions
        this.supportedExtensions = ['.glb', '.gltf', '.fbx', '.obj'];
        
        // Asset cache with metadata
        this.assets = new Map();
        
        // Default primitive assets (built-in)
        this.primitives = [
            { id: 'primitive:cube', name: 'Cube', category: 'Primitives', type: 'primitive', primitive: 'cube', defaultScale: { x: 1, y: 1, z: 1 } },
            { id: 'primitive:sphere', name: 'Sphere', category: 'Primitives', type: 'primitive', primitive: 'sphere', defaultScale: { x: 1, y: 1, z: 1 } },
            { id: 'primitive:cylinder', name: 'Cylinder', category: 'Primitives', type: 'primitive', primitive: 'cylinder', defaultScale: { x: 1, y: 1, z: 1 } },
            { id: 'primitive:cone', name: 'Cone', category: 'Primitives', type: 'primitive', primitive: 'cone', defaultScale: { x: 1, y: 1, z: 1 } },
            { id: 'primitive:plane', name: 'Plane', category: 'Primitives', type: 'primitive', primitive: 'plane', defaultScale: { x: 1, y: 1, z: 1 } },
            { id: 'primitive:torus', name: 'Torus', category: 'Primitives', type: 'primitive', primitive: 'torus', defaultScale: { x: 1, y: 1, z: 1 } }
        ];
        
        // Marker types (spawn points, portals, banks, item spawns, etc.)
        this.markerTypes = [
            { id: 'marker:spawn', name: 'Spawn Point', category: 'Markers', type: 'marker', markerType: 'spawn' },
            { id: 'marker:portal', name: 'Portal/Door', category: 'Markers', type: 'marker', markerType: 'portal' },
            { id: 'marker:anchor', name: 'Named Anchor', category: 'Markers', type: 'marker', markerType: 'anchor' },
            { id: 'marker:bank', name: 'Bank', category: 'Markers', type: 'marker', markerType: 'bank' },
            { id: 'marker:item_spawn', name: 'Item Spawn', category: 'Markers', type: 'marker', markerType: 'item_spawn' }
        ];
        
        // Ensure assets directory exists
        this.ensureAssetsDirectory();
        
        // Scan for assets
        this.scanAssets();
    }

    ensureAssetsDirectory() {
        if (!existsSync(this.assetsPath)) {
            mkdirSync(this.assetsPath, { recursive: true });
            console.log('Created assets directory:', this.assetsPath);
        }
    }

    scanAssets() {
        this.assets.clear();
        
        // Add primitives
        for (const prim of this.primitives) {
            this.assets.set(prim.id, prim);
        }
        
        // Add markers
        for (const marker of this.markerTypes) {
            this.assets.set(marker.id, marker);
        }
        
        // Scan file-based assets
        this.scanDirectory(this.assetsPath, '');
        
        console.log(`Loaded ${this.assets.size} assets (including ${this.primitives.length} primitives)`);
    }

    scanDirectory(dirPath, category) {
        if (!existsSync(dirPath)) return;
        
        try {
            const entries = readdirSync(dirPath);
            
            for (const entry of entries) {
                const fullPath = join(dirPath, entry);
                const stat = statSync(fullPath);
                
                if (stat.isDirectory()) {
                    // Use directory name as category
                    this.scanDirectory(fullPath, entry);
                } else if (stat.isFile()) {
                    const ext = extname(entry).toLowerCase();
                    if (this.supportedExtensions.includes(ext)) {
                        const id = `file:${category ? category + '/' : ''}${entry}`;
                        const name = basename(entry, ext);
                        
                        this.assets.set(id, {
                            id,
                            name,
                            category: category || 'Uncategorized',
                            type: 'file',
                            path: `/assets/${category ? category + '/' : ''}${entry}`,
                            extension: ext,
                            defaultScale: { x: 1, y: 1, z: 1 }
                        });
                    }
                }
            }
        } catch (err) {
            console.error('Error scanning assets directory:', err);
        }
    }

    // Get all available assets
    getAssetList() {
        const list = [];
        for (const [id, asset] of this.assets) {
            list.push(asset);
        }
        return list;
    }

    // Get assets by category
    getAssetsByCategory() {
        const categories = {};
        for (const [id, asset] of this.assets) {
            const cat = asset.category || 'Uncategorized';
            if (!categories[cat]) {
                categories[cat] = [];
            }
            categories[cat].push(asset);
        }
        return categories;
    }

    // Validate asset ID
    validateAsset(assetId) {
        return this.assets.has(assetId);
    }

    // Get asset by ID
    getAsset(assetId) {
        return this.assets.get(assetId);
    }

    // Refresh asset list (for hot-reload)
    refresh() {
        this.scanAssets();
        return this.getAssetList();
    }
}
