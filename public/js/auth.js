// ──────────────────────────────────────────────
// AUTH SESSION MANAGEMENT
// ──────────────────────────────────────────────

const AUTH = {
  TOKEN_KEY: 'session_token',
  USER_KEY: 'user',  // ← FIXED: matches login.html storage
  
  // Get stored token
  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },
  
  // Get stored user
  getUser() {
    try {
      const data = localStorage.getItem(this.USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },
  
  // Set session data
  setSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },
  
  // Clear session (logout)
  clearSession() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },
  
  // Check if user is logged in
  isLoggedIn() {
    return !!this.getToken() && !!this.getUser();
  },
  
  // Get auth header for API requests
  getAuthHeader() {
    const token = this.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  },
  
  // Update user data in storage
  updateUser(user) {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },
  
  // Verify token with server
  async verifySession() {
    const token = this.getToken();
    if (!token) return false;
    
    try {
      const response = await fetch('/api/auth/verify', {
        headers: this.getAuthHeader()
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          this.updateUser(data.user);
          return true;
        }
      }
      
      // Token invalid
      this.clearSession();
      return false;
      
    } catch (error) {
      console.error('Session verification error:', error);
      return false;
    }
  },
  
  // Login
  async login(identifier, password, remember = false) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, remember })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        this.setSession(data.token, data.user);
        return { success: true, user: data.user };
      }
      
      return { success: false, message: data.message || 'Login failed' };
      
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'Network error. Please try again.' };
    }
  },
  
  // Register
  async register(fullName, username, email, password) {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          full_name: fullName, 
          username, 
          email, 
          password 
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        this.setSession(data.token, data.user);
        return { success: true, user: data.user };
      }
      
      return { success: false, message: data.message || 'Registration failed' };
      
    } catch (error) {
      console.error('Register error:', error);
      return { success: false, message: 'Network error. Please try again.' };
    }
  },
  
  // Logout
  async logout() {
    try {
      const token = this.getToken();
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: this.getAuthHeader()
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      this.clearSession();
      window.location.href = '/';
    }
  }
};

// ──────────────────────────────────────────────
// EXPOSE TO GLOBAL SCOPE
// ──────────────────────────────────────────────
window.AUTH = AUTH;