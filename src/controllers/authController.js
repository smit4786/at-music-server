import { generateToken } from '../middleware/auth.js';

// In-memory user store (replace with database)
const users = new Map();

export const register = (req, res) => {
  try {
    const { username, lastfmUsername, lastfmApiKey } = req.body;
    
    if (!username || !lastfmUsername || !lastfmApiKey) {
      return res.status(400).json({
        error: 'Missing required fields: username, lastfmUsername, lastfmApiKey',
      });
    }
    
    if (users.has(username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    
    const userId = Date.now().toString();
    users.set(username, {
      userId,
      username,
      lastfmUsername,
      lastfmApiKey,
      createdAt: new Date(),
    });
    
    const token = generateToken(userId, username);
    
    res.status(201).json({
      token,
      user: {
        userId,
        username,
        lastfmUsername,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const login = (req, res) => {
  try {
    const { username, lastfmUsername, lastfmApiKey } = req.body;
    
    if (!username || !lastfmUsername || !lastfmApiKey) {
      return res.status(400).json({
        error: 'Missing required fields: username, lastfmUsername, lastfmApiKey',
      });
    }
    
    const user = users.get(username);
    if (!user || user.lastfmUsername !== lastfmUsername) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = generateToken(user.userId, user.username);
    
    res.json({
      token,
      user: {
        userId: user.userId,
        username: user.username,
        lastfmUsername: user.lastfmUsername,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const logout = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};

export default {
  register,
  login,
  logout,
};
