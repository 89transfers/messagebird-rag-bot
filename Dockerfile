# Use an official Node.js runtime as a parent image
FROM node:20-slim AS base

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker layer caching
COPY package*.json ./

# Install app dependencies using npm ci for faster, more reliable builds
RUN npm ci

# Copy the rest of the application's source code
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Define the command to run the app
CMD [ "node", "index.js" ]
