import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import { signToken } from '../../utils/jwt.js';
import { errorResponse, successResponse } from '../../utils/response.js';

export const login = async (req, res, next) => {
  try {
    const { email, password, userId } = req.body;

    // Direct account picker switch support (for easy role switching) or email/password
    let user;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    } else if (email) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user && password && user.passwordHash) {
        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
          return errorResponse(res, 'Invalid credentials', 401);
        }
      }
    }

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const token = signToken({ id: user.id, role: user.role, email: user.email, hotelId: user.hotelId || 'hotel-mercier' });

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      title: user.title,
      phone: user.phone,
      initials: user.initials,
      lastActive: user.lastActive,
      whatsapp: user.whatsapp,
    };

    return successResponse(res, { token, user: safeUser }, 'Login successful');
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req, res) => {
  return successResponse(res, { user: req.user }, 'Profile fetched');
};

export const getStaffList = async (req, res, next) => {
  try {
    const staff = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        title: true,
        phone: true,
        initials: true,
        lastActive: true,
        whatsapp: true,
      },
    });
    return successResponse(res, staff, 'Staff accounts list');
  } catch (error) {
    next(error);
  }
};
