export function Background() {
    return (
        <div className="fixed inset-0 -z-10 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-gray-100 via-white to-gray-50" />
            <div className="absolute inset-0 bg-[url('/api/noise')] opacity-50 mix-blend-soft-light" />
            <svg
                className="absolute inset-0 h-full w-full"
                xmlns="http://www.w3.org/2000/svg"
            >
                <defs>
                    <filter
                        id="blur"
                        x="-50%"
                        y="-50%"
                        width="200%"
                        height="200%"
                    >
                        <feGaussianBlur
                            in="SourceGraphic"
                            stdDeviation="50"
                        />
                    </filter>
                </defs>
                <path
                    d="M -100,150 C 320,-50 600,260 280,500 C -40,740 -320,420 -100,150"
                    fill="#e9d5ff"
                    opacity="0.3"
                    filter="url(#blur)"
                />
                <path
                    d="M 1200,300 C 1700,100 1850,700 1450,950 C 1050,1200 800,550 1200,300"
                    fill="#bfdbfe"
                    opacity="0.2"
                    filter="url(#blur)"
                />
                <path
                    d="M 400,0 C 850,-200 1050,450 650,600 C 250,750 -50,250 400,0"
                    fill="#ddd6fe"
                    opacity="0.2"
                    filter="url(#blur)"
                />
                <path
                    d="M 1000,-100 C 1400,-200 1750,300 1300,450 C 850,600 600,0 1000,-100"
                    fill="#f5f3ff"
                    opacity="0.25"
                    filter="url(#blur)"
                />
                <path
                    d="M 200,600 C 600,400 750,1000 350,1150 C -50,1300 -200,850 200,600"
                    fill="#dbeafe"
                    opacity="0.25"
                    filter="url(#blur)"
                />
                <path
                    d="M 800,500 C 1200,300 1400,800 1000,950 C 600,1100 400,750 800,500"
                    fill="#ede9fe"
                    opacity="0.6"
                    filter="url(#blur)"
                />
            </svg>
        </div>
    );
}
