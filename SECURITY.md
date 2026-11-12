# Security Policy

Please do not publish exploitable vulnerabilities in public issues. Report suspected vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting feature, when enabled. Include affected versions, reproduction steps, impact and a suggested mitigation if known.

Do not share real customer backups, GSTINs, phone numbers, addresses, invoices, signing keys or passwords in reports.

AtomBook is offline-first. Optional Google Drive sync stores data only in a hidden app folder of the user's own Drive (scope `drive.appdata`); on the web the short-lived access token is kept in localStorage; the desktop app keeps its refresh token in the main process, encrypted with the OS keystore; the Android app keeps it in app-private storage. Users are responsible for protecting their devices and keeping encrypted backups in a safe location.
