# Item Models

Place your item GLB/GLTF models in this folder. They will be automatically detected by the asset system.

## Naming Convention
- Use lowercase with hyphens: `bronze-sword.glb`, `leather-hood.glb`
- The filename (without extension) can be linked to items in the database via the `model_id` field

## Supported Formats
- `.glb` (recommended - binary format, smaller size)
- `.gltf` (JSON format with separate textures)

## Item Types
- **Weapons**: swords, axes, bows, etc.
- **Armor**: helms, chestplates, leggings, shields
- **Consumables**: food, potions
- **Misc**: coins, gems, crafting materials

## Database Linking
Items in the database have a `model_id` field that can reference these models.
Example: An item with `model_id = 'bronze-sword'` will use `bronze-sword.glb`.
