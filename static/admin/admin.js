document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = 'http://127.0.0.1:8000';

    const loginSection = document.getElementById('admin-login-section');
    const dashboardSection = document.getElementById('admin-dashboard');
    const loginForm = document.getElementById('admin-login-form');
    const logoutButton = document.getElementById('admin-logout-button');
    const messageArea = document.getElementById('message-area');
    const welcomeMessage = document.getElementById('welcome-message');

    updateUI();

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = e.target.username.value;
        const password = e.target.password.value;

        try {
            const response = await fetch(`${API_BASE_URL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || '로그인에 실패했습니다.');
            }

            localStorage.setItem('adminAccessToken', data.access_token);
            localStorage.setItem('adminUsername', username);

            showMessage('관리자 로그인 성공!', 'success');
            updateUI();

        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('adminAccessToken');
        localStorage.removeItem('adminUsername');
        showMessage('로그아웃 되었습니다.', 'success');
        updateUI();
    });

    function updateUI() {
        const token = localStorage.getItem('adminAccessToken');
        if (token) {
            loginSection.classList.add('hidden');
            dashboardSection.classList.remove('hidden');
            welcomeMessage.textContent = localStorage.getItem('adminUsername');
        } else {
            loginSection.classList.remove('hidden');
            dashboardSection.classList.add('hidden');
        }
    }

    function showMessage(message, type = 'info') {
        messageArea.textContent = message;
        messageArea.className = type === 'success' ? 'message-success' : 'message-error';
        messageArea.style.backgroundColor = type === 'success' ? '#4CAF50' : '#f44336';
        messageArea.style.color = 'white';

        setTimeout(() => {
            messageArea.textContent = '';
            messageArea.className = '';
            messageArea.style.backgroundColor = '';
            messageArea.style.color = '';
        }, 4000);
    }
});