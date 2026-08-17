/**
 * Auth client for the account API server (login, registration, session).
 * Formerly the REST sync client; the cross-device sync transport was removed
 * and only the authentication layer remains.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface AuthResponse {
    token: string;
    user: { id: string; email: string; subscriptionTier: string };
}

export type AuthUser = AuthResponse['user'];

// Storage keys
const TOKEN_KEY = 'plethora_auth_token';
const USER_KEY = 'plethora_user';

/**
 * Get stored auth token
 */
export function getAuthToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * Get stored user
 */
export function getUser(): AuthUser | null {
    const user = localStorage.getItem(USER_KEY);
    return user ? JSON.parse(user) : null;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
    return !!getAuthToken();
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const token = getAuthToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.error?.message || error.message || 'API request failed');
    }

    return response.json();
}

/**
 * Register a new account
 */
export async function register(email: string, password: string): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });

    localStorage.setItem(TOKEN_KEY, response.token);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));

    return response;
}

/**
 * Login to existing account
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });

    localStorage.setItem(TOKEN_KEY, response.token);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));

    return response;
}

/**
 * Logout and clear stored credentials
 */
export function logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('plethora_last_sync_version');
}

/**
 * Verify current auth token
 */
export async function verifyAuth(): Promise<boolean> {
    try {
        await apiRequest('/auth/verify');
        return true;
    } catch {
        logout();
        return false;
    }
}
