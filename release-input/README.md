# Upload the completed Manasikāra release package

Place the original complete `Manasikara-v2.0.1.wox` file in this folder in GitHub using **Add file → Upload files**. The `Publish uploaded Manasikara package` GitHub Actions workflow will verify the archive, restore the audio, run regression tests, publish the tested `.wox` under GitHub Releases at tag `v2.0.1`, and commit the missing sound files back to `main`.

Only upload a package that you own or are authorized to distribute, including the bundled Mudita recording. Do not rename the file; the expected path is `release-input/Manasikara-v2.0.1.wox`.

Watch the run in the repository Actions tab. The release asset URL will be `https://github.com/Archetype444/Wox.Plugin.Manasikara/releases/download/v2.0.1/Manasikara-v2.0.1.wox` once the run passes. This folder is an input staging area, not an alternative plugin installation path.
