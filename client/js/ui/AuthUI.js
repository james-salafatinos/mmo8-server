// Auth UI - handles login/register form

export class AuthUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.currentTab = 'login';
        this.pendingCredentials = null;
    }

    init() {
        const tabs = document.querySelectorAll('.auth-tab');
        const form = document.getElementById('auth-form');
        const submitBtn = document.getElementById('auth-submit');
        const forceLoginBtn = document.getElementById('force-login-btn');
        const errorDiv = document.getElementById('auth-error');

        // Tab switching
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.currentTab = tab.dataset.tab;
                submitBtn.textContent = this.currentTab === 'login' ? 'Login' : 'Register';
                errorDiv.textContent = '';
                document.getElementById('force-login-container').style.display = 'none';
            });
        });

        // Form submission
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('auth-username').value.trim();
            const password = document.getElementById('auth-password').value;

            if (!username || !password) {
                errorDiv.textContent = 'Please fill in all fields';
                return;
            }

            submitBtn.disabled = true;
            errorDiv.textContent = '';

            try {
                let result;
                if (this.currentTab === 'register') {
                    result = await this.networkManager.register(username, password);
                    if (result.success) {
                        // Auto-login after registration
                        result = await this.networkManager.login(username, password);
                    }
                } else {
                    result = await this.networkManager.login(username, password);
                }

                if (!result.success) {
                    if (result.existingSession) {
                        this.pendingCredentials = { username, password };
                        document.getElementById('force-login-container').style.display = 'block';
                    }
                    errorDiv.textContent = result.error;
                }
            } catch (err) {
                errorDiv.textContent = 'Connection error';
            }

            submitBtn.disabled = false;
        });

        // Force login button
        forceLoginBtn.addEventListener('click', async () => {
            if (!this.pendingCredentials) return;

            forceLoginBtn.disabled = true;
            const result = await this.networkManager.login(
                this.pendingCredentials.username,
                this.pendingCredentials.password,
                true
            );

            if (!result.success) {
                errorDiv.textContent = result.error;
            }
            forceLoginBtn.disabled = false;
        });
    }
}
