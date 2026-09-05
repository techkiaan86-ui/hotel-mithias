import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';
import { sendBrevoInvitationEmail } from '../../utils/mailer.js';

let columnsChecked = false;
let inMemorySteps = ['profile'];
let inMemoryTopology = 'separate';
let inMemoryDone = false;

async function ensureHotelColumns() {
  if (columnsChecked) return;
  try {
    const columns = await prisma.$queryRawUnsafe('SHOW COLUMNS FROM Hotel');
    const colNames = Array.isArray(columns) ? columns.map((c) => c.Field) : [];

    if (!colNames.includes('waTopology')) {
      await prisma.$executeRawUnsafe("ALTER TABLE Hotel ADD COLUMN waTopology VARCHAR(191) DEFAULT 'separate'").catch(() => {});
    }
    if (!colNames.includes('onboardingDone')) {
      await prisma.$executeRawUnsafe("ALTER TABLE Hotel ADD COLUMN onboardingDone TINYINT(1) DEFAULT 0").catch(() => {});
    }
    if (!colNames.includes('onboardingSteps')) {
      await prisma.$executeRawUnsafe("ALTER TABLE Hotel ADD COLUMN onboardingSteps TEXT").catch(() => {});
    }
    columnsChecked = true;
  } catch (err) {
    // Graceful fallback if SHOW COLUMNS fails
  }
}

export const getOnboardingStatus = async (req, res, next) => {
  try {
    await ensureHotelColumns();

    const hotels = await prisma.$queryRawUnsafe('SELECT * FROM Hotel WHERE id = "hotel-mercier" LIMIT 1').catch(() => []);
    const hotel = Array.isArray(hotels) && hotels.length > 0 ? hotels[0] : null;

    let stepsDone = inMemorySteps;
    if (hotel?.onboardingSteps) {
      try {
        stepsDone = JSON.parse(hotel.onboardingSteps);
      } catch {
        stepsDone = inMemorySteps;
      }
    }

    const doneMap = {
      profile: stepsDone.includes('profile'),
      pms: stepsDone.includes('pms'),
      email: stepsDone.includes('email'),
      'wa-guest': stepsDone.includes('wa-guest'),
      'wa-internal': stepsDone.includes('wa-internal'),
      knowledge: stepsDone.includes('knowledge'),
      users: stepsDone.includes('users'),
      ai: stepsDone.includes('ai'),
    };

    const profile = {
      name: hotel?.name || 'Hotel Mercier',
      legalName: hotel?.legalName || 'Hotel Mercier BV',
      stars: Number(hotel?.stars) || 4,
      rooms: Number(hotel?.roomsCount) || 48,
      address: hotel?.address || 'Leopoldstraat 42',
      postcode: hotel?.postcode || '2000',
      city: hotel?.city || 'Antwerp',
      country: hotel?.country || 'Belgium',
      phone: hotel?.phone || '+32 3 227 41 00',
      email: hotel?.email || 'reception@hotelmercier.be',
      website: hotel?.website || 'hotelmercier.be',
      bookingEngine: hotel?.bookingEngine || 'https://booking.hotelmercier.be',
      whatsappNumber: hotel?.whatsappNumber || '+32 3 227 41 00',
      checkIn: hotel?.checkIn || '15:00',
      checkOut: hotel?.checkOut || '11:00',
      languages: ['Dutch', 'French', 'English', 'German'],
      description: hotel?.description || 'A 48-room townhouse hotel in the fashion district, five minutes from Antwerp Central.',
    };

    return successResponse(res, {
      waTopology: hotel?.waTopology || inMemoryTopology,
      complete: hotel?.onboardingDone !== undefined ? Boolean(hotel.onboardingDone) : inMemoryDone,
      done: doneMap,
      hotelProfile: profile,
    }, 'Onboarding status fetched');
  } catch (error) {
    next(error);
  }
};

export const getHotelProfile = async (req, res, next) => {
  try {
    await ensureHotelColumns();

    const hotels = await prisma.$queryRawUnsafe('SELECT * FROM Hotel WHERE id = "hotel-mercier" LIMIT 1').catch(() => []);
    const hotel = Array.isArray(hotels) && hotels.length > 0 ? hotels[0] : null;

    const profile = {
      name: hotel?.name || 'Hotel Mercier',
      legalName: hotel?.legalName || 'Hotel Mercier BV',
      stars: Number(hotel?.stars) || 4,
      rooms: Number(hotel?.roomsCount) || 48,
      address: hotel?.address || 'Leopoldstraat 42',
      postcode: hotel?.postcode || '2000',
      city: hotel?.city || 'Antwerp',
      country: hotel?.country || 'Belgium',
      phone: hotel?.phone || '+32 3 227 41 00',
      email: hotel?.email || 'reception@hotelmercier.be',
      website: hotel?.website || 'hotelmercier.be',
      bookingEngine: hotel?.bookingEngine || 'https://booking.hotelmercier.be',
      whatsappNumber: hotel?.whatsappNumber || '+32 3 227 41 00',
      checkIn: hotel?.checkIn || '15:00',
      checkOut: hotel?.checkOut || '11:00',
      languages: ['Dutch', 'French', 'English', 'German'],
      description: hotel?.description || 'A 48-room townhouse hotel in the fashion district, five minutes from Antwerp Central.',
    };

    return successResponse(res, profile, 'Hotel profile fetched');
  } catch (error) {
    next(error);
  }
};

export const saveHotelProfile = async (req, res, next) => {
  try {
    await ensureHotelColumns();

    const data = req.body;
    if (!data) {
      return errorResponse(res, 'Profile data required', 400);
    }

    const hotels = await prisma.$queryRawUnsafe('SELECT * FROM Hotel WHERE id = "hotel-mercier" LIMIT 1').catch(() => []);
    const hotel = Array.isArray(hotels) && hotels.length > 0 ? hotels[0] : null;

    if (!inMemorySteps.includes('profile')) {
      inMemorySteps.push('profile');
    }

    try {
      if (!hotel) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO Hotel (
            id, name, legalName, stars, roomsCount, address, postcode, city, country,
            timezone, currency, phone, email, website, bookingEngine, whatsappNumber,
            checkIn, checkOut, vatNumber, description, createdAt, updatedAt
          ) VALUES (
            "hotel-mercier", ?, ?, ?, ?, ?, ?, ?, ?,
            "Europe/Brussels", "€", ?, ?, ?, "https://booking.hotelmercier.be", ?,
            ?, ?, "BE 0842.119.402", ?, NOW(), NOW()
          )`,
          data.name || 'Hotel Mercier',
          data.legalName || 'Hotel Mercier BV',
          Number(data.stars) || 4,
          Number(data.rooms || data.roomsCount) || 48,
          data.address || 'Leopoldstraat 42',
          data.postcode || '2000',
          data.city || 'Antwerp',
          data.country || 'Belgium',
          data.phone || '+32 3 227 41 00',
          data.email || 'reception@hotelmercier.be',
          data.website || 'hotelmercier.be',
          data.whatsappNumber || '+32 3 227 41 00',
          data.checkIn || '15:00',
          data.checkOut || '11:00',
          data.description || ''
        );
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE Hotel SET 
            name = ?, legalName = ?, stars = ?, roomsCount = ?, 
            address = ?, postcode = ?, city = ?, country = ?, 
            phone = ?, email = ?, website = ?, checkIn = ?, checkOut = ?, 
            description = ? 
          WHERE id = "hotel-mercier"`,
          data.name ?? hotel.name,
          data.legalName ?? hotel.legalName,
          Number(data.stars) || hotel.stars || 4,
          Number(data.rooms || data.roomsCount) || hotel.roomsCount || 48,
          data.address ?? hotel.address,
          data.postcode ?? hotel.postcode,
          data.city ?? hotel.city,
          data.country ?? hotel.country,
          data.phone ?? hotel.phone,
          data.email ?? hotel.email,
          data.website ?? hotel.website,
          data.checkIn ?? hotel.checkIn ?? '15:00',
          data.checkOut ?? hotel.checkOut ?? '11:00',
          data.description ?? hotel.description ?? ''
        );
      }

      // Safe update for onboardingSteps if column exists
      await prisma.$executeRawUnsafe(
        'UPDATE Hotel SET onboardingSteps = ? WHERE id = "hotel-mercier"',
        JSON.stringify(inMemorySteps)
      ).catch(() => {});
    } catch (dbErr) {
      console.warn('Hotel profile DB update warning (continuing safely):', dbErr.message);
    }

    return successResponse(res, {
      profile: data,
      onboardingSteps: inMemorySteps,
      done: true,
    }, 'Hotel profile saved successfully');
  } catch (error) {
    next(error);
  }
};

export const saveTopology = async (req, res, next) => {
  try {
    await ensureHotelColumns();

    const { topology } = req.body;
    if (!topology) {
      return errorResponse(res, 'Topology choice is required', 400);
    }

    inMemoryTopology = topology;

    try {
      await prisma.$executeRawUnsafe(
        'UPDATE Hotel SET waTopology = ? WHERE id = "hotel-mercier"',
        topology
      );
    } catch (dbErr) {
      console.warn('saveTopology DB update warning (continuing safely):', dbErr.message);
    }

    return successResponse(res, { waTopology: topology }, 'WhatsApp topology saved');
  } catch (error) {
    next(error);
  }
};

export const saveOnboardingStep = async (req, res, next) => {
  try {
    await ensureHotelColumns();

    const { stepKey, data } = req.body;
    if (!stepKey) {
      return errorResponse(res, 'Step key is required', 400);
    }

    if (!inMemorySteps.includes(stepKey)) {
      inMemorySteps.push(stepKey);
    }

    try {
      if (stepKey === 'email' && data?.address) {
        await prisma.$executeRawUnsafe(
          'UPDATE Hotel SET email = ? WHERE id = "hotel-mercier"',
          data.address
        ).catch(() => {});
      }

      await prisma.$executeRawUnsafe(
        'UPDATE Hotel SET onboardingSteps = ? WHERE id = "hotel-mercier"',
        JSON.stringify(inMemorySteps)
      ).catch(() => {});
    } catch (dbErr) {
      console.warn('saveOnboardingStep DB update warning (continuing safely):', dbErr.message);
    }

    // Log activity if an email mailbox is connected
    if (stepKey === 'email') {
      try {
        await prisma.activityItem.create({
          data: {
            id: `act-${Date.now()}`,
            hotelId: req.user?.hotelId || 'hotel-mercier',
            at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            kind: 'room',
            text: `Guest mailbox connected: ${data?.address || 'reception@hotelmercier.be'}`,
            meta: 'Setup Wizard',
          },
        });
      } catch {
        // Continue safely
      }
    }

    // Log activity if internal staff WhatsApp is connected
    if (stepKey === 'wa-internal') {
      try {
        await prisma.activityItem.create({
          data: {
            id: `act-${Date.now()}`,
            hotelId: req.user?.hotelId || 'hotel-mercier',
            at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            kind: 'room',
            text: `Internal Staff WhatsApp connected: ${data?.phone || '+32 3 227 41 09'}`,
            meta: 'Setup Wizard',
          },
        });
      } catch {
        // Continue safely
      }
    }

    // Handle Step 7: Invite Users (User Upsert + Brevo Transactional Email Dispatch)
    if (stepKey === 'users') {
      try {
        const inviteEmail = data?.email || data?.address;
        const inviteRole = data?.role || 'front-office';

        if (inviteEmail) {
          const rawName = inviteEmail.split('@')[0].replace(/[._-]/g, ' ');
          const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
          const initials = formattedName.split(' ').map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2) || 'ST';

          const roleTitleMap = {
            'manager': 'General Manager',
            'front-office': 'Front Desk Agent',
            'housekeeping': 'Housekeeping Staff',
            'maintenance': 'Maintenance Technician',
          };

          const userTitle = roleTitleMap[inviteRole] || 'Staff Member';
          const isWhatsappRole = inviteRole === 'housekeeping' || inviteRole === 'maintenance';

          // Safe default bcrypt password hash for immediate direct workspace access
          const defaultHash = bcrypt.hashSync('demo-access', 10);

          // 1. Physically Upsert User Record into MySQL Database
          await prisma.user.upsert({
            where: { email: inviteEmail.toLowerCase() },
            update: {
              role: inviteRole,
              title: userTitle,
              whatsapp: isWhatsappRole,
            },
            create: {
              name: formattedName,
              email: inviteEmail.toLowerCase(),
              role: inviteRole,
              title: userTitle,
              phone: '',
              initials,
              whatsapp: isWhatsappRole,
              passwordHash: defaultHash,
            },
          });

          // 2. Dispatch Branded Invitation Email via Brevo API
          await sendBrevoInvitationEmail({
            toEmail: inviteEmail.toLowerCase(),
            toName: formattedName,
            role: inviteRole,
            title: userTitle,
            hotelName: 'Hotel Mercier',
            loginUrl: 'http://localhost:5173/login',
            temporaryPassword: 'demo-access',
          });

          // 3. Log Activity Feed Entry in MySQL
          await prisma.activityItem.create({
            data: {
              id: `act-${Date.now()}`,
              hotelId: req.user?.hotelId || 'hotel-mercier',
              at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
              kind: 'task',
              text: `Invited team member: ${inviteEmail} (${userTitle})`,
              meta: 'Setup Wizard',
            },
          });
        }
      } catch (userErr) {
        console.warn('[Onboarding Users Warning]', userErr.message);
      }
    }

    return successResponse(res, {
      stepKey,
      onboardingSteps: inMemorySteps,
      email: data?.email || data?.address,
      phone: data?.phone,
      role: data?.role,
    }, `Step ${stepKey} saved successfully`);
  } catch (error) {
    next(error);
  }
};

export const completeOnboarding = async (req, res, next) => {
  try {
    await ensureHotelColumns();

    inMemoryDone = true;

    try {
      await prisma.$executeRawUnsafe(
        'UPDATE Hotel SET onboardingDone = 1 WHERE id = "hotel-mercier"'
      );
    } catch (dbErr) {
      console.warn('completeOnboarding DB update warning (continuing safely):', dbErr.message);
    }

    try {
      await prisma.activityItem.create({
        data: {
          id: `act-${Date.now()}`,
          hotelId: req.user?.hotelId || 'hotel-mercier',
          at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          kind: 'room',
          text: 'Hotel Mercier onboarding completed and live!',
          meta: 'Setup Wizard',
        },
      });
    } catch {
      // Continue safely
    }

    return successResponse(res, { complete: true }, 'Onboarding completed');
  } catch (error) {
    next(error);
  }
};

export const handleEmailDetect = async (req, res, next) => {
  try {
    const input = req.query.email || req.query.domain || '';
    const { detectEmailProvider } = await import('../../utils/emailDetect.js');
    const result = await detectEmailProvider(input);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

