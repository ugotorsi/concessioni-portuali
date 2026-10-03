import type { NextConfig } from "next";

const commonSecurityHeaders = [
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	{ key: "X-DNS-Prefetch-Control", value: "on" },
];

const productionContentSecurityPolicy = [
	"default-src 'self'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"object-src 'none'",
	"script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self' https://vitals.vercel-insights.com",
	"worker-src 'self' blob:",
	"manifest-src 'self'",
	"upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
	async headers() {
		const headers = [...commonSecurityHeaders];

		if (process.env.NODE_ENV === "production") {
			headers.push({
				key: "Strict-Transport-Security",
				value: "max-age=31536000; includeSubDomains",
			});
			headers.push({
				key: "Content-Security-Policy",
				value: productionContentSecurityPolicy,
			});
		}

		return [
			{
				source: "/:path*",
				headers,
			},
		];
	},
};

export default nextConfig;
