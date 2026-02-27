/**
 * @file prisma/seed.ts
 * @description Seed the categories lookup table with a standard set of place
 * categories.  Run with: npx prisma db seed
 *
 * Idempotent — uses upsert so it is safe to run multiple times.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
  { slug: 'restaurant',  name: 'Restaurant',    description: 'Dine-in restaurants and eateries' },
  { slug: 'cafe',        name: 'Café',           description: 'Coffee shops and casual cafés' },
  { slug: 'bakery',      name: 'Bakery',         description: 'Bakeries and pastry shops' },
  { slug: 'hotel',       name: 'Hotel',          description: 'Hotels, resorts and guest houses' },
  { slug: 'clinic',      name: 'Clinic',         description: 'Medical clinics and doctor offices' },
  { slug: 'hospital',    name: 'Hospital',       description: 'Hospitals and emergency care' },
  { slug: 'pharmacy',    name: 'Pharmacy',       description: 'Pharmacies and drug stores' },
  { slug: 'gym',         name: 'Gym',            description: 'Fitness centres and gyms' },
  { slug: 'salon',       name: 'Salon',          description: 'Hair salons and beauty parlours' },
  { slug: 'spa',         name: 'Spa',            description: 'Spas and wellness centres' },
  { slug: 'school',      name: 'School',         description: 'Schools, colleges and coaching centres' },
  { slug: 'bank',        name: 'Bank',           description: 'Banks and ATMs' },
  { slug: 'supermarket', name: 'Supermarket',    description: 'Supermarkets and grocery stores' },
  { slug: 'electronics', name: 'Electronics',    description: 'Electronics and appliance stores' },
  { slug: 'services',    name: 'Services',       description: 'General business and professional services' },
  { slug: 'therapy',     name: 'Therapy Center', description: 'Therapy, counselling and rehabilitation' },
  { slug: 'other',       name: 'Other',          description: 'Other / uncategorised places' },
];

async function main() {
  console.log('Seeding categories…');

  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where:  { slug: cat.slug },
      update: { name: cat.name, description: cat.description },
      create: cat,
    });
  }

  console.log(`✅  ${CATEGORIES.length} categories seeded.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
