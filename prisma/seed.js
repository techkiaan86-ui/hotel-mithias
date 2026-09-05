import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding for Hotel Mercier (hotel_db)...');

  // 1. Hotel Profile
  await prisma.hotel.upsert({
    where: { id: 'hotel-mercier' },
    update: {},
    create: {
      id: 'hotel-mercier',
      name: 'Hotel Mercier',
      legalName: 'Hotel Mercier BV',
      stars: 4,
      roomsCount: 48,
      address: 'Leopoldstraat 42',
      postcode: '2000',
      city: 'Antwerp',
      country: 'Belgium',
      timezone: 'Europe/Brussels',
      currency: '€',
      phone: '+32 3 227 41 00',
      email: 'reception@hotelmercier.be',
      website: 'hotelmercier.be',
      bookingEngine: 'hotelmercier.be/book',
      whatsappNumber: '+32 3 227 41 08',
      checkIn: '15:00',
      checkOut: '11:00',
      vatNumber: 'BE 0784.512.339',
      description:
        'A 48-room townhouse hotel in the fashion district, five minutes from Antwerp Central. Courtyard-facing Deluxe rooms, a small spa and a breakfast room that opens at 07:00.',
    },
  });

  // 2. Staff Users
  const defaultPassword = await bcrypt.hash('password123', 10);
  const staffMembers = [
    {
      id: 'u-jonas',
      name: 'Jonas Verhaeghe',
      email: 'jonas@hotelmercier.be',
      role: 'manager',
      title: 'General Manager',
      phone: '+32 478 20 11 46',
      initials: 'JV',
      lastActive: 'now',
      whatsapp: true,
    },
    {
      id: 'u-amelie',
      name: 'Amélie Duprez',
      email: 'amelie@hotelmercier.be',
      role: 'front-office',
      title: 'Front Office Agent',
      phone: '+32 471 55 09 32',
      initials: 'AD',
      lastActive: '2 min ago',
      whatsapp: true,
    },
    {
      id: 'u-rosa',
      name: 'Rosa Ferreira',
      email: 'rosa@hotelmercier.be',
      role: 'housekeeping',
      title: 'Housekeeping Manager',
      phone: '+32 465 88 12 70',
      initials: 'RF',
      lastActive: '14 min ago',
      whatsapp: true,
    },
    {
      id: 'u-peter',
      name: 'Peter Janssens',
      email: 'peter@hotelmercier.be',
      role: 'maintenance',
      title: 'Technical Manager',
      phone: '+32 494 31 62 18',
      initials: 'PJ',
      lastActive: '6 min ago',
      whatsapp: true,
    },
    {
      id: 'u-thibault',
      name: 'Thibault Mertens',
      email: 'thibault@hotelmercier.be',
      role: 'front-office',
      title: 'Night Auditor',
      phone: '+32 472 14 88 03',
      initials: 'TM',
      lastActive: 'yesterday 23:40',
      whatsapp: false,
    },
  ];

  for (const s of staffMembers) {
    await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        ...s,
        passwordHash: defaultPassword,
      },
    });
  }

  // 3. 48 Rooms (12 rooms per floor across 4 floors)
  const cleaners = ['Maria Silva', 'Inês Duarte', 'Kadir Yılmaz', 'Alina Popescu'];
  const rooms = [];

  for (let floor = 1; floor <= 4; floor++) {
    for (let i = 1; i <= 12; i++) {
      const roomNum = `${floor}${String(i).padStart(2, '0')}`;
      let status = 'Clean';
      let cleaningType = 'Departure';
      let guestStatus = 'Vacant';
      let priority = 'Normal';
      let cleaner = cleaners[(floor + i) % cleaners.length];
      let vip = false;
      let arrivalTime = undefined;
      let note = undefined;

      if (roomNum === '401') {
        status = 'Cleaning';
        cleaningType = 'Departure';
        guestStatus = 'Vacant';
        arrivalTime = '13:00';
        priority = 'Urgent';
        cleaner = 'Maria Silva';
        note = 'Early check-in requested by Grace Okonkwo';
      } else if (roomNum === '302') {
        status = 'Dirty';
        cleaningType = 'Stayover';
        guestStatus = 'In House';
        priority = 'Normal';
        cleaner = 'Inês Duarte';
      } else if (roomNum === '208') {
        status = 'Clean';
        cleaningType = 'VIP Arrival';
        guestStatus = 'Vacant';
        arrivalTime = '15:00';
        priority = 'High';
        vip = true;
        cleaner = 'Kadir Yılmaz';
        note = 'Baby cot placed in room';
      } else if (roomNum === '205') {
        status = 'Clean';
        cleaningType = 'Stayover + Linen';
        guestStatus = 'In House';
      } else if (roomNum === '307') {
        status = 'Inspected';
        cleaningType = 'VIP Arrival';
        guestStatus = 'Vacant';
        vip = true;
        arrivalTime = '16:00';
      } else if (roomNum === '112') {
        status = 'Maintenance';
        cleaningType = 'Departure';
        note = 'AC thermostat fault';
      } else if (i % 3 === 0) {
        status = 'Dirty';
        cleaningType = 'Stayover';
        guestStatus = 'In House';
      }

      rooms.push({
        number: roomNum,
        floor,
        status,
        cleaningType,
        guestStatus,
        arrivalTime,
        priority,
        cleaner,
        vip,
        note,
        updatedAt: '08:30',
      });
    }
  }

  for (const r of rooms) {
    await prisma.room.upsert({
      where: { number: r.number },
      update: r,
      create: r,
    });
  }

  // 4. Sample Guests & Reservations
  const sampleGuests = [
    {
      id: 'g-bertrand',
      name: 'Clara Bertrand',
      room: '302',
      country: 'France',
      language: 'French',
      vip: false,
      previousStays: 2,
      tags: JSON.stringify(['Quiet room', 'Late riser']),
      reservation: {
        number: 'MRC-48219',
        arrival: '16 Aug',
        departure: '19 Aug',
        nights: 3,
        adults: 2,
        children: 0,
        roomType: 'Deluxe King',
        status: 'In House',
        rate: '€189 / night',
      },
    },
    {
      id: 'g-okonkwo',
      name: 'Grace Okonkwo',
      room: '401',
      country: 'United Kingdom',
      language: 'English',
      vip: false,
      previousStays: 0,
      tags: JSON.stringify(['Early arrival 13:00']),
      reservation: {
        number: 'MRC-48288',
        arrival: '18 Aug',
        departure: '20 Aug',
        nights: 2,
        adults: 2,
        children: 0,
        roomType: 'Deluxe King',
        status: 'Confirmed',
        rate: '€196 / night',
      },
    },
    {
      id: 'g-tanabe',
      name: 'Yuki Tanabe',
      room: '307',
      country: 'Japan',
      language: 'English',
      vip: true,
      previousStays: 5,
      tags: JSON.stringify(['VIP', 'Returning', 'Prefers high floor']),
      reservation: {
        number: 'MRC-48301',
        arrival: '18 Aug',
        departure: '22 Aug',
        nights: 4,
        adults: 2,
        children: 0,
        roomType: 'Junior Suite',
        status: 'Confirmed',
        rate: '€268 / night',
      },
    },
    {
      id: 'g-raghavan',
      name: 'Priya Raghavan',
      room: '208',
      country: 'India',
      language: 'English',
      vip: false,
      previousStays: 0,
      tags: JSON.stringify(['Baby cot requested']),
      reservation: {
        number: 'MRC-48297',
        arrival: '18 Aug',
        departure: '21 Aug',
        nights: 3,
        adults: 2,
        children: 1,
        roomType: 'Family Room',
        status: 'Confirmed',
        rate: '€224 / night',
      },
    },
  ];

  for (const g of sampleGuests) {
    const { reservation, ...guestData } = g;
    await prisma.guest.upsert({
      where: { id: guestData.id },
      update: guestData,
      create: guestData,
    });

    if (reservation) {
      await prisma.reservation.upsert({
        where: { number: reservation.number },
        update: { ...reservation, guestId: guestData.id },
        create: { ...reservation, guestId: guestData.id },
      });
    }
  }

  // 5. Sample Tasks
  const sampleTasks = [
    {
      id: 't-101',
      title: 'Prepare Room 401 for early arrival (13:00)',
      detail: 'Grace Okonkwo requested early check-in. Extra towels needed.',
      room: '401',
      guest: 'Grace Okonkwo',
      department: 'Housekeeping',
      priority: 'Urgent',
      createdAt: '07:30',
      due: '12:30',
      assignee: 'Maria Silva',
      status: 'In Progress',
      source: 'Guest WhatsApp',
      trail: [
        { at: '07:30', text: 'Task auto-detected from WhatsApp conversation', via: 'ai' },
        { at: '07:45', text: 'Assigned to Maria Silva', via: 'dashboard' },
      ],
    },
    {
      id: 't-102',
      title: 'Place baby cot in Room 208',
      detail: 'Priya Raghavan arriving with infant.',
      room: '208',
      guest: 'Priya Raghavan',
      department: 'Housekeeping',
      priority: 'High',
      createdAt: '08:00',
      due: '14:00',
      assignee: 'Kadir Yılmaz',
      status: 'Completed',
      source: 'Front Office',
      trail: [
        { at: '08:00', text: 'Task created by Front Desk', via: 'dashboard' },
        { at: '09:15', text: 'Baby cot placed and verified by Kadir', via: 'whatsapp' },
      ],
    },
    {
      id: 't-103',
      title: 'Print VIP Welcome Letter for Yuki Tanabe',
      room: '307',
      guest: 'Yuki Tanabe',
      department: 'VIP',
      priority: 'Normal',
      createdAt: '08:15',
      due: '15:30',
      assignee: 'Amélie Duprez',
      status: 'New',
      source: 'Manager',
      trail: [{ at: '08:15', text: 'Created for VIP arrival', via: 'dashboard' }],
    },
  ];

  for (const t of sampleTasks) {
    const { trail, ...taskData } = t;
    const task = await prisma.task.upsert({
      where: { id: taskData.id },
      update: taskData,
      create: taskData,
    });

    for (const tr of trail) {
      await prisma.taskTrail.create({
        data: {
          taskId: task.id,
          at: tr.at,
          text: tr.text,
          via: tr.via,
        },
      });
    }
  }

  // 6. Sample Issues (Maintenance)
  const sampleIssues = [
    {
      id: 'MT-104',
      room: '112',
      title: 'AC Thermostat not cooling below 24C',
      detail: 'Reported by morning guest during check-out.',
      priority: 'High',
      reportedBy: 'Amélie Duprez',
      via: 'Front Office',
      createdAt: '08:20',
      assignee: 'Peter Janssens',
      status: 'In Progress',
      outOfService: true,
      updates: [
        { at: '08:20', text: 'Reported by Front Office', via: 'dashboard' },
        { at: '08:35', text: 'Peter inspecting compressor unit', via: 'whatsapp' },
      ],
    },
    {
      id: 'MT-105',
      room: '204',
      title: 'Bathroom sink slow drain',
      priority: 'Normal',
      reportedBy: 'Inês Duarte',
      via: 'Housekeeping',
      createdAt: '09:00',
      status: 'Reported',
      outOfService: false,
      updates: [{ at: '09:00', text: 'Reported during room clean', via: 'dashboard' }],
    },
  ];

  for (const iss of sampleIssues) {
    const { updates, ...issueData } = iss;
    const issue = await prisma.issue.upsert({
      where: { id: issueData.id },
      update: issueData,
      create: issueData,
    });

    for (const up of updates) {
      await prisma.issueUpdate.create({
        data: {
          issueId: issue.id,
          at: up.at,
          text: up.text,
          via: up.via,
        },
      });
    }
  }

  // 7. Upsells
  const sampleUpsells = [
    {
      id: 'up-1',
      guest: 'Grace Okonkwo',
      room: '401',
      offer: 'Early Check-in at 13:00',
      value: 35.0,
      channel: 'whatsapp',
      status: 'Accepted',
      date: 'Today',
    },
    {
      id: 'up-2',
      guest: 'Yuki Tanabe',
      room: '307',
      offer: 'Antwerp Gourmet Breakfast Package',
      value: 56.0,
      channel: 'email',
      status: 'Sent',
      date: 'Today',
    },
    {
      id: 'up-3',
      guest: 'Clara Bertrand',
      room: '302',
      offer: 'Spa & Sauna Evening Pass',
      value: 45.0,
      channel: 'whatsapp',
      status: 'Declined',
      date: 'Yesterday',
    },
  ];

  for (const up of sampleUpsells) {
    await prisma.upsell.upsert({
      where: { id: up.id },
      update: up,
      create: up,
    });
  }

  // 8. AI Rules
  const sampleRules = [
    { topic: 'Late Checkout up to 13:00', mode: 'Autonomous', note: 'Can grant if room is not occupied next day.' },
    { topic: 'Refund or Disputed Billing', mode: 'Always Escalate', note: 'Requires GM approval before replying.' },
    { topic: 'Breakfast / Wi-Fi FAQ', mode: 'Autonomous', note: 'Answer directly from Hotel Knowledge base.' },
  ];

  for (const r of sampleRules) {
    await prisma.aiRule.create({ data: r });
  }

  // 9. Knowledge Docs
  const sampleDocs = [
    {
      id: 'kd-1',
      name: 'Hotel Mercier Guest Directory & Amenities.pdf',
      category: 'Hotel Information',
      format: 'PDF',
      size: '2.4 MB',
      updated: '12 Aug',
      status: 'Indexed',
      aiReady: true,
      usedToday: 18,
    },
    {
      id: 'kd-2',
      name: 'Breakfast Menu & Local Recommendations.pdf',
      category: 'Local Recommendations',
      format: 'PDF',
      size: '1.8 MB',
      updated: '10 Aug',
      status: 'Indexed',
      aiReady: true,
      usedToday: 9,
    },
    {
      id: 'kd-3',
      name: 'Cancellation and Pet Policy.docx',
      category: 'Hotel Policies',
      format: 'DOCX',
      size: '450 KB',
      updated: '14 Aug',
      status: 'Indexed',
      aiReady: true,
      usedToday: 6,
    },
  ];

  for (const d of sampleDocs) {
    await prisma.knowledgeDoc.upsert({
      where: { id: d.id },
      update: d,
      create: d,
    });
  }

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
