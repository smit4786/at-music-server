import jwt from 'jsonwebtoken';
import config from '../config/config.js';

export const generateToken = (userId, username) => {
  return jwt.sign(
    { userId, username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiration }
  );
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (error) {
    return null;
  }
};

export const authenticateUser = (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  req.user = decoded;
  next();
};

export default {
  generateToken,
  verifyToken,
  authenticateUser,
};
