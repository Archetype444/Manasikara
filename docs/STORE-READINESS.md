# Store readiness

Store submission has not been started or approved. The public release gate is
not complete: the supplied meditation recording is pending permission for
public publication, and running-Wox validation remains outstanding.
The intended project name is Wox.Plugin.Manasikara; the plugin display name is
Wox.Plugin.Manasikāra and its original ID is ad468a1d-fdb5-4fb0-88a9-d6778bb11d96.

Before a store PR:

1. Upload this project to an authorized public repository and set metadata
   Website to that actual repository URL.
2. Complete representative running-Wox validation on Windows.
3. Publish the matching version tag and confirm the `.wox` release is public.
4. Use the public repository's `assets/icon.svg` URL. Add a real Wox screenshot
   when available; do not invent one from mocked test results.
5. Ask the user whether they want a store submission.
6. Follow the submission skill's fork gate. Reuse an existing Wox fork, or
   have the user create one if no permitted creation method is available.
7. Check the exact plugin ID in the current upstream store-plugin.json.
   Do not add another entry when the ID is already listed.
8. Add only the verified store entry on a branch in the user's fork, then
   open a pull request against Wox-launcher/Wox.

Normalize store Runtime to nodejs and SupportedOS to Windows/Darwin/Linux.
Copy other identity fields from local metadata. Use the actual public release
asset URL and current Europe/London timestamps. All bundled sound provenance
is retained; the supplied Mudita recording is not represented as CC0.

The complete skill is in `wox-skills/wox-plugin-submit2store/SKILL.md`.
