FROM node:20-bullseye

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --only=production

COPY dist/ ./dist/

EXPOSE 3000

CMD ["node", "dist/main.js"]
