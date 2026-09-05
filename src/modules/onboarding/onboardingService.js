import { prisma } from '../../config/database.js';

export const onboardingService = {
  async getStatus(hotelId) {
    let targetHotelId = hotelId;
    let hotelExists = await prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotelExists) {
      const defaultHotel = await prisma.hotel.findFirst();
      if (defaultHotel) targetHotelId = defaultHotel.id;
    }

    const state = await prisma.onboardingState.upsert({
      where: { hotelId: targetHotelId },
      update: {},
      create: {
        hotelId: targetHotelId,
        pmsDone: false,
        emailDone: false,
        guestWaDone: false,
        internalWaDone: false,
        kbDone: false,
        usersDone: false,
        aiDone: false,
        currentStep: 1,
      },
    });

    return state;
  },

  async updateStatus(hotelId, data) {
    let targetHotelId = hotelId;
    let hotelExists = await prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotelExists) {
      const defaultHotel = await prisma.hotel.findFirst();
      if (defaultHotel) targetHotelId = defaultHotel.id;
    }

    const updated = await prisma.onboardingState.upsert({
      where: { hotelId: targetHotelId },
      update: {
        ...data,
      },
      create: {
        hotelId: targetHotelId,
        ...data,
      },
    });

    return updated;
  },
};
