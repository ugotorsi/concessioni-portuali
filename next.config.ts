import type { NextConfig } from "next";

const commonSecurityHeaders = [
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	{ key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
	async headers() {
		const headers = [...commonSecurityHeaders];

		if (process.env.NODE_ENV === "production") {
			headers.push({
				key: "Strict-Transport-Security",
				value: "max-age=31536000; includeSubDomains",
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
