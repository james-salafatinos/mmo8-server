// MusicUI - Music player with track selection
export class MusicUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.container = null;
        this.audio = new Audio();
        this.currentTrack = null;
        this.isPlaying = false;
        this.volume = 0.5;
        
        // Music tracks (will load from assets/music folder)
        this.tracks = [
            { id: 'town', name: 'Town Theme', file: '/assets/music/town.mp3', icon: '🏘️' },
            { id: 'adventure', name: 'Adventure', file: '/assets/music/adventure.mp3', icon: '⚔️' },
            { id: 'dungeon', name: 'Dungeon Depths', file: '/assets/music/dungeon.mp3', icon: '🏰' },
            { id: 'battle', name: 'Battle Cry', file: '/assets/music/battle.mp3', icon: '🎺' },
            { id: 'peaceful', name: 'Peaceful Meadow', file: '/assets/music/peaceful.mp3', icon: '🌳' },
            { id: 'mystery', name: 'Mystery', file: '/assets/music/mystery.mp3', icon: '🔮' },
        ];
        
        this.audio.volume = this.volume;
        this.audio.addEventListener('ended', () => this.onTrackEnd());
        
        this.init();
    }
    
    init() {
        this.container = document.createElement('div');
        this.container.className = 'music-content tab-content';
        this.render();
    }
    
    render() {
        this.container.innerHTML = '';
        
        // Track list
        const trackList = document.createElement('div');
        trackList.className = 'music-track-list';
        
        for (const track of this.tracks) {
            const item = document.createElement('div');
            item.className = 'music-track';
            if (this.currentTrack === track.id) {
                item.classList.add('playing');
            }
            
            item.innerHTML = `
                <span class="track-icon">${track.icon}</span>
                <span class="track-name">${track.name}</span>
                <span class="track-status">${this.currentTrack === track.id && this.isPlaying ? '▶️' : ''}</span>
            `;
            
            item.addEventListener('click', () => this.playTrack(track));
            trackList.appendChild(item);
        }
        
        this.container.appendChild(trackList);
        
        // Controls
        const controls = document.createElement('div');
        controls.className = 'music-controls';
        controls.innerHTML = `
            <button class="music-prev" title="Previous">⏮️</button>
            <button class="music-play" title="Play/Pause">${this.isPlaying ? '⏸️' : '▶️'}</button>
            <button class="music-stop" title="Stop">⏹️</button>
            <button class="music-next" title="Next">⏭️</button>
            <input type="range" class="volume-slider" min="0" max="100" value="${this.volume * 100}" title="Volume">
        `;
        
        controls.querySelector('.music-prev').addEventListener('click', () => this.prevTrack());
        controls.querySelector('.music-play').addEventListener('click', () => this.togglePlay());
        controls.querySelector('.music-stop').addEventListener('click', () => this.stop());
        controls.querySelector('.music-next').addEventListener('click', () => this.nextTrack());
        controls.querySelector('.volume-slider').addEventListener('input', (e) => {
            this.setVolume(e.target.value / 100);
        });
        
        this.container.appendChild(controls);
    }
    
    playTrack(track) {
        if (this.currentTrack === track.id && this.isPlaying) {
            this.togglePlay();
            return;
        }
        
        this.currentTrack = track.id;
        this.audio.src = track.file;
        this.audio.play().then(() => {
            this.isPlaying = true;
            this.render();
        }).catch(err => {
            console.log('Music playback failed:', err.message);
            // Show placeholder message
            this.isPlaying = false;
            this.render();
        });
    }
    
    togglePlay() {
        if (!this.currentTrack) {
            if (this.tracks.length > 0) {
                this.playTrack(this.tracks[0]);
            }
            return;
        }
        
        if (this.isPlaying) {
            this.audio.pause();
            this.isPlaying = false;
        } else {
            this.audio.play().catch(() => {});
            this.isPlaying = true;
        }
        this.render();
    }
    
    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this.render();
    }
    
    nextTrack() {
        if (!this.currentTrack) {
            this.playTrack(this.tracks[0]);
            return;
        }
        const idx = this.tracks.findIndex(t => t.id === this.currentTrack);
        const next = this.tracks[(idx + 1) % this.tracks.length];
        this.playTrack(next);
    }
    
    prevTrack() {
        if (!this.currentTrack) {
            this.playTrack(this.tracks[this.tracks.length - 1]);
            return;
        }
        const idx = this.tracks.findIndex(t => t.id === this.currentTrack);
        const prev = this.tracks[(idx - 1 + this.tracks.length) % this.tracks.length];
        this.playTrack(prev);
    }
    
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        this.audio.volume = this.volume;
    }
    
    onTrackEnd() {
        this.nextTrack();
    }
    
    getContentElement() {
        return this.container;
    }
}
