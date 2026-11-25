# Product images

EcoCraft stores **image URLs** in the `products.images` array; MongoDB does not store the photograph itself. An artist can paste a direct HTTPS image link or upload an image from their computer using Cloudinary.

Image uploads are optional. A listing can be submitted without a photo. Products still require admin approval before they appear in **Explore**.

## Option 1: Use an HTTPS image URL

1. Sign in with an approved artist account.
2. Open **My studio / account → My creations** and fill in the product details.
3. Paste a direct HTTPS image address into the image URL field. Use an image you have permission to publish.
4. Submit the product for approval. Once an admin approves it, check the image in **Explore**.

The URL should point directly to an image, not to a web page containing an image.

## Option 2: Upload from your computer

Uploads go from the browser to Flask, then to Cloudinary. Flask handles the Cloudinary credentials; the browser receives only the hosted HTTPS URL.

1. Create or use a team-controlled [Cloudinary](https://cloudinary.com/) account.
2. Add these values to your local `.env` (never to JavaScript or GitHub):

   ```dotenv
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ```

3. Restart Flask.
4. Sign in as an approved artist, choose a product photograph in the listing form, and submit it for review.
5. Approve the listing as admin and confirm the hosted image appears in **Explore**.

Accepted formats: JPEG, PNG and WebP, up to **4 MB** per upload. The backend checks file size and known file signatures. It does not perform full image decoding.

## Editing or replacing a photo

Use **Edit** on one of your eligible listings. You can keep the existing image, provide a different HTTPS URL, upload a replacement, or remove the image. Editing a listed product saves directly; editing a rejected product sends it back for admin review.

## Troubleshooting

| Message or behavior | What to check |
| --- | --- |
| Image upload is not configured (503) | Cloudinary values are missing from `.env` or Flask was not restarted. Use an HTTPS URL as an alternative. |
| Invalid image (400) | Select a real JPEG, PNG or WebP file. Renaming another file to `.jpg` will not make it valid. |
| File too large (413) | Reduce the image to 4 MB or less. |
| Upload failed (502) | Check Cloudinary credentials and service connectivity without exposing secrets. |
| Image missing from the catalog | Check the image URL and confirm the product has been approved and listed. |

An image that uploads successfully but is not attached to a saved product can remain in Cloudinary. Automatic cleanup of unused uploads is not part of this project.
