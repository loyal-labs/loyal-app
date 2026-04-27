import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#developers", label: "Developers" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#blog", label: "Blog" },
  { href: "#footer", label: "Links" },
];

export function LandingHeader() {
  return (
    <header className="flex w-full justify-center bg-[#f9363c]">
      <div className="relative flex w-full max-w-[1560px] items-end justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link
            aria-label="Loyal home"
            className="relative h-11 w-14 shrink-0"
            href="/"
          >
            <Image
              alt="Loyal"
              className="absolute left-0 top-[11px]"
              height={24}
              priority
              src="/landing/figma/header-logotype.svg"
              width={56}
            />
          </Link>

          <nav
            aria-label="Main navigation"
            className="hidden max-w-[800px] items-end p-1 md:flex"
          >
            <div className="flex items-center">
              {navLinks.map((link) => (
                <Link
                  className="flex items-center justify-center rounded-full px-4 py-2 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-white hover:text-[#f9363c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
                  href={link.href}
                  key={link.label}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        </div>

        <Image
          alt=""
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 hidden h-11 w-[98px] -translate-x-1/2 -translate-y-1/2 md:block"
          height={44}
          priority
          src="/landing/figma/header-eye.svg"
          width={98}
        />

        <Link
          className="flex shrink-0 items-center justify-center rounded-full bg-black px-4 py-3 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
          href="#get-started"
        >
          Get started
        </Link>
      </div>
    </header>
  );
}
