FROM node:20-bullseye

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg 

WORKDIR /usr/src/app

# Copy the local module first
COPY ./temp/youtube-exec /usr/src/app/temp/youtube-exec

# Then copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your application
COPY dist/ ./dist/

EXPOSE 3000

CMD ["node", "dist/main.js"]
