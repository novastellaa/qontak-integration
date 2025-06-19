# Gunakan Node.js image resmi
FROM node:16

# Set direktori kerja di dalam container
WORKDIR /app

# Salin package.json dan package-lock.json untuk install dependensi
COPY package*.json ./

# Install dependensi
RUN npm install

# Salin semua file dari proyek ke container
COPY . .

# Expose port 6666 jika server Express kamu juga perlu mendengarkan di container
EXPOSE 6666

# Perintah untuk menjalankan worker.js
CMD ["node", "utils/worker.js"]
