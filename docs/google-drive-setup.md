# Google Drive backend setup

HDW CONNECT uses a Netlify function to access the private folder `HDW connect document`, owned by `wadhdw25.hkl@moh.gov.my`. This is an ordinary My Drive folder, so uploads use the owner's OAuth authorization. Staff sign in with Google. Every request verifies the Google ID token and checks the signed-in email against the folder's current named Editor or Owner permissions. Owner refresh tokens and the client secret stay on the backend. Existing offline vault use remains available without Google sign-in.

## Google sign-in setup

In Google Cloud project `hdw-connect`, configure Google Auth Platform branding and audience. If the audience is External and the application is in Testing, add `azlan8232@gmail.com`, `wadhdw25.hkl@moh.gov.my`, and the approved staff as test users. For an Internal audience, staff must belong to that Workspace organization. The owner connection requests `https://www.googleapis.com/auth/drive`; configure this scope under Google Auth Platform → Data access. Google can require verification for production use of this restricted scope. Testing-mode refresh tokens for Drive access expire after seven days, so Testing is suitable for setup checks, not an unattended ongoing connection.

Create an OAuth client of type **Web application**, named **HDW CONNECT staff sign-in**. Add this Authorized JavaScript origin:

```
https://hdw-connect.netlify.app
```

Staff authentication uses the Google Identity Services ID token button. Owner authorization uses its separate popup authorization-code flow. Google uses the calling page origin as the popup redirect URI, so the backend exchanges the code with `redirect_uri=https://hdw-connect.netlify.app`. Copy the public client ID into Netlify as `GOOGLE_CLIENT_ID` and the same client's secret as `GOOGLE_CLIENT_SECRET`. Never paste the secret into chat or frontend code.

## Netlify environment variables

Set these in Project configuration → Environment variables, then deploy the changed app. Include the Functions scope; All scopes works when scope selection is unavailable. Never use a `VITE_` prefix for credentials or allowlists.

| Key | Value |
| --- | --- |
| `GOOGLE_CLIENT_SECRET` | Secret from the existing web OAuth client, marked secret |
| `GOOGLE_DRIVE_FOLDER_ID` | `1MTX4PTpVHJIXehpO2aWyJztZlxzI_3KI` |
| `GOOGLE_CLIENT_ID` | Public web OAuth client ID |
| `HDW_ADMIN_EMAILS` | `azlan8232@gmail.com` |
| `HDW_ALLOWED_EMAILS` | Legacy setting; no longer used for record access |

HDW_ADMIN_EMAILS controls owner setup and backup administration. Every record operation, including an administrator's, also requires a current named Editor or Owner permission on the destination folder. Share directly to each user's email; group, domain-wide, link-only, Viewer, deleted and expired permissions do not grant app access. Permissions are checked on each request, without caching staff approval. Changing these settings requires redeployment. Only Gmail and Google Workspace identities are supported. Tokens stay in React memory and expire with Google's ID token; sign out and sign back in to renew.

Keep combined function environment variables under Netlify's approximately 4 KB limit. `GOOGLE_SERVICE_ACCOUNT_JSON` is no longer needed in owner mode and can be removed from Netlify to free space. Do not put credentials into the repository, publish directory, logs, chat, or a public file.

Keep General access Restricted. On the production website, sign into Drive as the administrator (`azlan8232@gmail.com`) and choose **Connect folder owner**. The owner must select `wadhdw25.hkl@moh.gov.my` in Google's popup and approve Drive access. Google grants account-level Drive access, while the backend limits record operations to the configured folder and HDW CONNECT file markers. The backend verifies the approving account, folder ownership and ability to add files before saving the connection. Refresh tokens are encrypted with AES-GCM using a key derived from the client secret and saved in the private, site-wide `hdw-drive-owner` Netlify Blobs store. No endpoint returns the token. Rotating the client secret requires reconnecting the owner. Reconnection is restricted to administrators, the production origin and a custom request header. Non-production contexts cannot save an owner connection. Other staff sign in with their own Google accounts and must be named Editors of the folder. They do not need the owner's password. The owner connection is site-wide and persists across devices and deployments.

For an actual Shared drive deployment, explicitly set `GOOGLE_DRIVE_AUTH_MODE=service-account` and provide `GOOGLE_SERVICE_ACCOUNT_JSON` instead. The default is owner authorization; it does not silently fall back to the service account when owner authorization is missing or expired.

## Use and validation

Unlock the device's local vault and open About & Backup → Record transfer. Choose Google Drive or Manual transfer. Both use the same readable .hdwtransfer record format and require no transfer passphrase. Local vaults and full backups remain encrypted. Drive transfers rely on approved Google sign-in and private Drive folder permissions; anyone with direct folder access can read the transfer contents.

For Google Drive, select records, sign in with an approved Google account and choose Confirm transfer to Google Drive. On another device, sign in, choose Receive from Google Drive to refresh the files, then Receive on this device beside the desired file. The Drive send and receive buttons remain visible before sign-in but are disabled until an approved account signs in. For Manual transfer, choose Confirm transfer and download, send the record file through your chosen channel, and choose Receive from file on the receiving device. Selecting a file opens its preview automatically. Review patient records and resolve each conflict below before choosing Confirm and import. Older passphrase-encrypted Drive files remain supported and prompt for their original passphrase. The existing import logic preserves Final document snapshots. Files are never automatically imported or synchronized.

Administrators can back up the full vault and load an encrypted backup for preview. Restoring requires an account name and passphrase from the source backup, plus explicit confirmation to replace local records. Staff cannot list, upload, or download full backups through the backend.

Files are limited to 3.5 MB to stay within Netlify buffered payload limits. Filenames use timestamps and random IDs, with no patient identifiers. List pagination is supported. Upload and download events record Google subject ID, file ID, kind and timestamp in Netlify function logs; these are operational logs with platform retention, not a permanent clinical audit database.

The app displays a link to its configured destination folder. Each successful upload must have a Google file ID and the configured parent folder before the backend reports success. Its receipt links to Google's returned file URL when available. A file-list refresh failure after upload is reported separately so staff do not accidentally repeat a successful upload.

Before patient use, test with synthetic records: upload and restore a backup; transfer to a second device; reject an unapproved Google account and conflicts without a decision; check Final document preservation. Confirm the owner connection and the uploaded file in the destination folder. Automated tests do not verify your live credentials, Workspace policies or deployed Netlify routing.

References: [Google authorization code popup](https://developers.google.com/identity/oauth2/web/guides/use-code-model), [Google server-side OAuth and refresh tokens](https://developers.google.com/identity/protocols/oauth2/web-server), [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Google ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Netlify function environment variables](https://docs.netlify.com/build/functions/environment-variables/).
