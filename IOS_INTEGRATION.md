# @AT_Music iOS - Backend Integration Guide

This guide explains how to integrate the custom Node.js backend with the iOS app.

## Overview

**Current Setup:**
```
iOS App → Last.fm API (direct)
```

**New Setup:**
```
iOS App → Backend Server → Last.fm API
```

**Benefits:**
- Better caching (no rate limits)
- Secure credential handling
- Future multi-service support
- Analytics & insights

---

## Step 1: Deploy Backend Server

### Option A: Railway.app (Easiest)

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub"
3. Select this repository
4. Add environment variables:
   - `LASTFM_API_KEY` - Your Last.fm API key
   - `JWT_SECRET` - Generate a random string
5. Deploy! Get your public URL (e.g., `https://at-music-server.railway.app`)

### Option B: Local Testing

```bash
cd at-music-server
npm install
cp .env.example .env
# Edit .env with your Last.fm API key
npm run dev
```

Server runs at `http://localhost:3000`

---

## Step 2: Update iOS App

### Create ServerClient Class

Create new file: `Services/ServerClient.swift`

```swift
import Foundation

class ServerClient {
    private let baseURL: URL
    private var authToken: String?
    
    init(baseURL: String) {
        self.baseURL = URL(string: baseURL)!
    }
    
    // MARK: - Authentication
    
    func register(
        username: String,
        lastfmUsername: String,
        lastfmApiKey: String
    ) async throws -> String {
        let endpoint = baseURL.appending(path: "api/auth/register")
        
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: String] = [
            "username": username,
            "lastfmUsername": lastfmUsername,
            "lastfmApiKey": lastfmApiKey,
        ]
        
        request.httpBody = try JSONEncoder().encode(body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 201 else {
            throw ServerError.invalidResponse
        }
        
        let result = try JSONDecoder().decode(AuthResponse.self, from: data)
        self.authToken = result.token
        
        return result.token
    }
    
    func login(
        username: String,
        lastfmUsername: String,
        lastfmApiKey: String
    ) async throws -> String {
        let endpoint = baseURL.appending(path: "api/auth/login")
        
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: String] = [
            "username": username,
            "lastfmUsername": lastfmUsername,
            "lastfmApiKey": lastfmApiKey,
        ]
        
        request.httpBody = try JSONEncoder().encode(body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw ServerError.unauthorized
        }
        
        let result = try JSONDecoder().decode(AuthResponse.self, from: data)
        self.authToken = result.token
        
        return result.token
    }
    
    // MARK: - Tracks
    
    func getRecentTracks(
        username: String,
        page: Int = 1,
        limit: Int = 50
    ) async throws -> [Track] {
        guard let token = authToken else {
            throw ServerError.notAuthenticated
        }
        
        let endpoint = baseURL
            .appending(path: "api/tracks/recent")
            .appending(queryItems: [
                URLQueryItem(name: "page", value: String(page)),
                URLQueryItem(name: "limit", value: String(limit)),
            ])
        
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: String] = ["username": username]
        request.httpBody = try JSONEncoder().encode(body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw ServerError.serverError
        }
        
        let result = try JSONDecoder().decode(TracksResponse.self, from: data)
        return result.tracks
    }
    
    func getUserInfo(username: String) async throws -> UserInfo {
        guard let token = authToken else {
            throw ServerError.notAuthenticated
        }
        
        let endpoint = baseURL.appending(path: "api/tracks/info")
        
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: String] = ["username": username]
        request.httpBody = try JSONEncoder().encode(body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw ServerError.serverError
        }
        
        return try JSONDecoder().decode(UserInfo.self, from: data)
    }
}

// MARK: - Models

struct AuthResponse: Codable {
    let token: String
    let user: UserData
}

struct UserData: Codable {
    let userId: String
    let username: String
    let lastfmUsername: String
}

struct TracksResponse: Codable {
    let tracks: [Track]
    let page: Int
    let limit: Int
}

enum ServerError: LocalizedError {
    case invalidResponse
    case unauthorized
    case notAuthenticated
    case serverError
    
    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid server response"
        case .unauthorized:
            return "Unauthorized"
        case .notAuthenticated:
            return "Not authenticated. Please login first."
        case .serverError:
            return "Server error"
        }
    }
}
```

### Update AccountsView

Add server integration:

```swift
import SwiftUI

struct AccountsView: View {
    // ... existing code ...
    
    @State private var serverURL: String = UserDefaults.standard.string(forKey: "serverURL") ?? "https://at-music-server.railway.app"
    @State private var useServer: Bool = UserDefaults.standard.bool(forKey: "useServer")
    
    private var serverClient: ServerClient {
        ServerClient(baseURL: serverURL)
    }
    
    var body: some View {
        NavigationStack {
            Form {
                // Server Settings
                Section(header: Text("Backend Server (Optional)")) {
                    Toggle("Use Custom Server", isOn: $useServer)
                        .onChange(of: useServer) { _, value in
                            UserDefaults.standard.set(value, forKey: "useServer")
                        }
                    
                    if useServer {
                        TextField("Server URL", text: $serverURL)
                            .onChange(of: serverURL) { _, value in
                                UserDefaults.standard.set(value, forKey: "serverURL")
                            }
                    }
                }
                
                // ... rest of existing code ...
            }
        }
    }
    
    private func saveCredentials() {
        isLoading = true
        errorMessage = nil
        
        if useServer {
            saveCredentialsViaServer()
        } else {
            saveCredentialsLocally()
        }
    }
    
    private func saveCredentialsViaServer() {
        Task {
            do {
                let token = try await serverClient.register(
                    username: username,
                    lastfmUsername: username,
                    lastfmApiKey: apiKey
                )
                
                // Save token locally
                try KeychainManager.shared.save(value: token, for: "SERVER_AUTH_TOKEN")
                
                showSaveSuccess = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    showSaveSuccess = false
                }
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
    
    private func saveCredentialsLocally() {
        do {
            try viewModel.setCredentials(apiKey: apiKey, username: username)
            showSaveSuccess = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                showSaveSuccess = false
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
```

### Update LastFMService

Make it use ServerClient when enabled:

```swift
class LastFMService: LastFMServiceProtocol {
    private let apiClient: LastFMAPIClient
    private let serverClient: ServerClient?
    private let useServer: Bool
    
    init(useServer: Bool = false) {
        self.useServer = useServer
        self.apiClient = LastFMAPIClient()
        
        if useServer {
            if let serverURL = UserDefaults.standard.string(forKey: "serverURL") {
                self.serverClient = ServerClient(baseURL: serverURL)
            } else {
                self.serverClient = nil
            }
        } else {
            self.serverClient = nil
        }
    }
    
    func fetchRecentTracks(page: Int) async throws -> [Track] {
        if useServer, let serverClient = serverClient {
            // Use server
            let username = try keychainManager.retrieve(for: "LASTFM_USER") ?? ""
            return try await serverClient.getRecentTracks(username: username, page: page)
        } else {
            // Use direct API (existing code)
            return try await apiClient.getRecentTracks(...)
        }
    }
}
```

---

## Step 3: Deploy & Test

1. Deploy backend to Railway.app
2. Update iOS app with ServerClient
3. In Accounts tab, toggle "Use Custom Server"
4. Enter server URL
5. Save credentials → Now uses backend!

---

## Advantages

✅ **No Rate Limits** - Backend caches results
✅ **Better Security** - API keys on server, not in app
✅ **Analytics** - Track user behavior
✅ **Multi-Service** - Easy to add Spotify, Apple Music later
✅ **Scalable** - Can handle thousands of users

---

## Architecture Flow

```
User enters credentials
    ↓
Sends to backend via ServerClient
    ↓
Backend stores securely, returns JWT token
    ↓
iOS app stores token in Keychain
    ↓
Subsequent requests use token (no credentials sent)
    ↓
Backend proxies to Last.fm with hidden keys
    ↓
Results cached and returned to app
```

---

## Future: Multi-Service

Once server is set up, adding new services is easy:

```swift
// Add Spotify
struct SpotifyService {
    func getRecentTracks() async throws -> [Track]
}

// Backend routes request based on user preference
POST /api/tracks/recent?service=spotify
POST /api/tracks/recent?service=lastfm (default)
```

---

**Ready to deploy?** Let me know if you need help with Railway setup! 🚀
