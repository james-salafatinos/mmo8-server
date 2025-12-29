// LogoutUI - Logout panel for the game dock

export class LogoutUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.contentElement = null;
    }

    getContentElement() {
        if (!this.contentElement) {
            this.contentElement = document.createElement('div');
            this.contentElement.className = 'logout-content';
            this.contentElement.innerHTML = `
                <div class="logout-panel">
                    <p class="logout-warning">Are you sure you want to logout?</p>
                    <button class="logout-confirm-btn">Logout</button>
                </div>
            `;
            
            this.contentElement.querySelector('.logout-confirm-btn').addEventListener('click', () => {
                this.networkManager.clearSession();
                window.location.reload();
            });
        }
        return this.contentElement;
    }
}
