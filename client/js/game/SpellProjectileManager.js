// SpellProjectileManager - handles visual spell projectiles and effects
import * as THREE from 'three';

export class SpellProjectileManager {
    constructor(scene, playerManager = null) {
        this.scene = scene;
        this.playerManager = playerManager;
        this.projectiles = [];
        this.effects = [];
    }
    
    // Set player manager reference (for tracking targets)
    setPlayerManager(playerManager) {
        this.playerManager = playerManager;
    }

    // Create and launch a projectile that tracks a moving target
    launchTrackingProjectile(startPos, targetUserId, spellData, onHit) {
        const color = spellData.color || 0xff4400;
        
        // Create projectile mesh
        const geometry = new THREE.SphereGeometry(0.2, 16, 16);
        const material = new THREE.MeshBasicMaterial({ 
            color: color,
            transparent: true,
            opacity: 0.9
        });
        const projectile = new THREE.Mesh(geometry, material);
        projectile.position.copy(startPos);
        
        // Add glow effect
        const glowGeometry = new THREE.SphereGeometry(0.4, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.3
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        projectile.add(glow);
        
        // Add point light
        const light = new THREE.PointLight(color, 1, 5);
        projectile.add(light);
        
        this.scene.add(projectile);
        
        // Store projectile with target tracking
        this.projectiles.push({
            mesh: projectile,
            startPos: startPos.clone(),
            targetUserId: targetUserId,
            progress: 0,
            speed: 10,
            onHit: onHit,
            spellData: spellData,
            tracking: true
        });
    }

    // Create and launch a projectile from caster to target (static position - legacy)
    launchProjectile(startPos, endPos, spellData, onHit) {
        const color = spellData.color || 0xff4400;
        
        // Create projectile mesh (glowing sphere)
        const geometry = new THREE.SphereGeometry(0.2, 16, 16);
        const material = new THREE.MeshBasicMaterial({ 
            color: color,
            transparent: true,
            opacity: 0.9
        });
        const projectile = new THREE.Mesh(geometry, material);
        projectile.position.copy(startPos);
        
        // Add glow effect (larger transparent sphere)
        const glowGeometry = new THREE.SphereGeometry(0.4, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.3
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        projectile.add(glow);
        
        // Add point light for dynamic lighting
        const light = new THREE.PointLight(color, 1, 5);
        projectile.add(light);
        
        this.scene.add(projectile);
        
        // Store projectile data
        this.projectiles.push({
            mesh: projectile,
            startPos: startPos.clone(),
            endPos: endPos.clone(),
            progress: 0,
            speed: 8, // units per second
            onHit: onHit,
            spellData: spellData
        });
    }

    // Create heal effect on a player
    showHealEffect(position, color = 0x44ff44) {
        // Create rising particles effect
        const particleCount = 10;
        const particles = [];
        
        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.SphereGeometry(0.1, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.8
            });
            const particle = new THREE.Mesh(geometry, material);
            
            // Random position around the target
            particle.position.set(
                position.x + (Math.random() - 0.5) * 1,
                position.y,
                position.z + (Math.random() - 0.5) * 1
            );
            
            this.scene.add(particle);
            particles.push({
                mesh: particle,
                startY: particle.position.y,
                velocity: 1 + Math.random() * 2,
                life: 1.0
            });
        }
        
        this.effects.push({
            type: 'heal',
            particles: particles,
            elapsed: 0,
            duration: 1.5
        });
    }

    // Create teleport effect
    showTeleportEffect(startPos, endPos, color = 0xaa44ff) {
        // Vanish effect at start
        this.createTeleportBurst(startPos, color);
        
        // Appear effect at end (delayed)
        setTimeout(() => {
            this.createTeleportBurst(endPos, color);
        }, 200);
    }

    createTeleportBurst(position, color) {
        // Create expanding ring effect
        const geometry = new THREE.RingGeometry(0.1, 0.3, 32);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(geometry, material);
        ring.position.copy(position);
        ring.rotation.x = -Math.PI / 2;
        
        this.scene.add(ring);
        
        this.effects.push({
            type: 'teleport',
            mesh: ring,
            elapsed: 0,
            duration: 0.5,
            startScale: 1
        });
    }

    // Update all projectiles and effects
    update(deltaTime) {
        // Update projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            
            // Get target position (tracking or static)
            let targetPos;
            if (proj.tracking && proj.targetUserId && this.playerManager) {
                const target = this.playerManager.players.get(proj.targetUserId)
                            || this.playerManager.players.get(Number(proj.targetUserId))
                            || this.playerManager.players.get(String(proj.targetUserId));
                if (target && target.mesh) {
                    targetPos = target.mesh.position.clone();
                    targetPos.y += 0.5; // Center of player
                } else {
                    targetPos = proj.endPos || proj.startPos;
                }
            } else {
                targetPos = proj.endPos;
            }
            
            // Calculate distance and travel
            const currentPos = proj.mesh.position;
            const distance = currentPos.distanceTo(targetPos);
            const moveDistance = proj.speed * deltaTime;
            
            if (distance <= moveDistance || distance < 0.3) {
                // Hit target
                proj.mesh.position.copy(targetPos);
                if (proj.onHit) proj.onHit();
                
                // Create impact effect
                this.createImpactEffect(targetPos, proj.spellData.color);
                
                // Remove projectile
                this.scene.remove(proj.mesh);
                proj.mesh.geometry.dispose();
                proj.mesh.material.dispose();
                this.projectiles.splice(i, 1);
            } else {
                // Move toward target
                const direction = new THREE.Vector3().subVectors(targetPos, currentPos).normalize();
                proj.mesh.position.add(direction.multiplyScalar(moveDistance));
            }
        }
        
        // Update effects
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const effect = this.effects[i];
            effect.elapsed += deltaTime;
            
            if (effect.elapsed >= effect.duration) {
                // Remove effect
                this.removeEffect(effect);
                this.effects.splice(i, 1);
            } else {
                // Update effect
                this.updateEffect(effect, deltaTime);
            }
        }
    }

    updateEffect(effect, deltaTime) {
        const progress = effect.elapsed / effect.duration;
        
        if (effect.type === 'heal') {
            // Update heal particles
            for (const particle of effect.particles) {
                particle.mesh.position.y += particle.velocity * deltaTime;
                particle.mesh.material.opacity = 0.8 * (1 - progress);
                particle.mesh.scale.setScalar(1 - progress * 0.5);
            }
        } else if (effect.type === 'teleport') {
            // Expand and fade ring
            const scale = 1 + progress * 4;
            effect.mesh.scale.set(scale, scale, scale);
            effect.mesh.material.opacity = 0.9 * (1 - progress);
        } else if (effect.type === 'impact') {
            // Expand and fade impact
            const scale = 1 + progress * 2;
            effect.mesh.scale.set(scale, scale, scale);
            effect.mesh.material.opacity = 0.7 * (1 - progress);
        }
    }

    removeEffect(effect) {
        if (effect.type === 'heal') {
            for (const particle of effect.particles) {
                this.scene.remove(particle.mesh);
                particle.mesh.geometry.dispose();
                particle.mesh.material.dispose();
            }
        } else if (effect.mesh) {
            this.scene.remove(effect.mesh);
            effect.mesh.geometry.dispose();
            effect.mesh.material.dispose();
        }
    }

    createImpactEffect(position, color) {
        const geometry = new THREE.SphereGeometry(0.3, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.7
        });
        const impact = new THREE.Mesh(geometry, material);
        impact.position.copy(position);
        
        this.scene.add(impact);
        
        this.effects.push({
            type: 'impact',
            mesh: impact,
            elapsed: 0,
            duration: 0.4
        });
    }
}
