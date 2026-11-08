import { Camera, Globe, Star } from "lucide-react";
export default function Footer() {
  const LINKS = {
    company: "Atomprod",
    tagline: "GST & Billing",
    repo: "https://github.com/kaifcoding/atombook",
    instagram: "https://instagram.com/captainkaifx",
    instagramHandle: "@captainkaifx",
    site: "https://atombook.atomprod.in",
  };
  return (
    <footer className="card my-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold">
          AtomBook{" "}
          <span className="font-normal text-gray-500">by {LINKS.company}</span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{LINKS.tagline}</p>
        <p className="mt-1 text-[11px] text-gray-400">
          Developed by {LINKS.instagramHandle}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={LINKS.repo}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary btn-sm"
        >
          <Star size={14} /> Star on GitHub
        </a>
        <a
          href={LINKS.instagram}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost btn-sm"
        >
          <Camera size={14} /> Instagram
        </a>
        <a
          href={LINKS.site}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost btn-sm"
        >
          <Globe size={14} /> Website
        </a>
      </div>
    </footer>
  );
}
