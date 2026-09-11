#!/bin/sh
set -e

echo "[Docker Entrypoint] Memeriksa dan menjalankan migrasi database..."
node database/migrate.js up

echo "[Docker Entrypoint] Memeriksa dan menjalankan seeding awal (aman, non-destruktif tanpa --force)..."
node database/seed-sop-data.js

echo "[Docker Entrypoint] Menjalankan server aplikasi RS Awal Bros..."
exec node server/server.js
