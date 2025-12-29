# Custom Assets Folder

Place your custom 3D models here to use them in the map editor.

## Supported Formats
- `.glb` (recommended - binary glTF)
- `.gltf` (glTF with separate files)
- `.fbx` (Autodesk FBX)
- `.obj` (Wavefront OBJ)

## Folder Structure
Organize assets into subfolders to create categories in the editor:

```
assets/
├── Buildings/
│   ├── house.glb
│   ├── castle.glb
│   └── tower.glb
├── Props/
│   ├── barrel.glb
│   ├── crate.glb
│   └── torch.glb
├── Nature/
│   ├── tree.glb
│   ├── rock.glb
│   └── bush.glb
└── door.glb  (shows as "Uncategorized")
```

## How to Add Assets

1. Export your model from Blender (or other 3D software) as `.glb`
2. Place the file in this `assets/` folder (or a subfolder for categorization)
3. In the editor, click the **↻ Refresh** button in the Asset palette
4. Your model will appear in the asset list under its category

## Tips for Blender Export

1. Select your model
2. File → Export → glTF 2.0 (.glb/.gltf)
3. Settings:
   - Format: glTF Binary (.glb)
   - Include: Selected Objects
   - Transform: +Y Up
   - Geometry: Apply Modifiers
4. Export

## Metadata in Editor

Once placed, you can set object properties in the Inspector:
- **Collidable**: Whether players collide with this object
- **Interactable**: Whether players can interact (right-click/long-press)
- **Interaction Type**: Door, Chest, NPC, Switch, Portal, Custom
