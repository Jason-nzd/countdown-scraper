// Used by index.ts for copying images into Azure Storage blob containers
import { BlobServiceClient, ContainerClient, RestError } from '@azure/storage-blob';
import * as dotenv from 'dotenv';
import { colour, log } from './logging.js';
import { Product } from './typings';
dotenv.config();

const containerName = 'countdownimages';

let blobServiceClient: BlobServiceClient;
let containerClient: ContainerClient;
let transparentImageClient: ContainerClient;

// Check if .env contains azure storage connection string
const AZURE_STORAGE_CONSTRING = process.env.AZURE_STORAGE_CONSTRING;
if (!AZURE_STORAGE_CONSTRING) {
  throw Error('Azure Storage Connection String AZURE_STORAGE_CONSTRING not found in .env');
}

try {
  // Connect with connection string
  blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONSTRING);

  // Create ContainerClient for container 'countdownimages'
  containerClient = blobServiceClient.getContainerClient(containerName);
  transparentImageClient = blobServiceClient.getContainerClient('transparent-cd-images');
} catch (error) {
  throw Error('Azure Storage Connection String invalid');
}

export default async function uploadImageToAzureStorage(product: Product, url: string) {
  try {
    // Use id as the filename
    const blobFilename = product.id + '.jpg';

    // Check if file already exists on Azure Storage
    const transparentImageBlob = transparentImageClient.getBlobClient(blobFilename);
    if (await transparentImageBlob.exists()) return false;
    const blobClient = containerClient.getBlockBlobClient(blobFilename);
    if (await blobClient.exists()) return false;

    // If image doesn't already exist on azure storage, attempt upload
    const uploadReponse = await blobClient.syncCopyFromURL(url);

    if (uploadReponse.copyStatus === 'success') {
      log(
        colour.grey,
        'New Image: ' + blobFilename.padStart(10) + ' - ' + product.name.slice(0, 50)
      );
      return true;
    } else {
      log(colour.red, '- Image upload failed: ' + url + ' - status: ' + uploadReponse.copyStatus);
      return false;
    }
  } catch (e) {
    // RestError often occurs when the original image is missing
    if ((e as Error).name === 'RestError') {
      log(colour.grey, 'Image URL Unavailable: ' + product.id + ' - ' + product.name.slice(0, 30));
    } else {
      // Print the full error for other errors
      console.log(e);
    }
    // Return false for an unsuccessful upload
    return false;
  }
}
