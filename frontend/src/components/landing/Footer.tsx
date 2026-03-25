export function Footer() {
  return (
    <footer id="contact" className="border-t border-white/5 bg-[#080020]">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          {/* Brand */}
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-purple">
              <span className="text-sm font-semibold text-white font-mono">1</span>
            </div>
            <span className="text-lg font-semibold text-white font-mono">1Reach</span>
          </a>

          {/* Copyright and Privacy */}
          <div className="flex items-center gap-6">
            <p className="text-sm text-[#a99cc4]">
              {new Date().getFullYear()} 1Reach. All rights reserved.
            </p>
            <a
              href="/privacy"
              className="text-sm text-[#a99cc4] transition-colors hover:text-white"
            >
              Privacy
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
