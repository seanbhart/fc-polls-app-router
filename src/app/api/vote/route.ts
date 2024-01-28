import { NextRequest, NextResponse } from 'next/server'
import { Poll } from "@app/types";
import { kv } from "@vercel/kv";
import { getSSLHubRpcClient, Message } from "@farcaster/hub-nodejs";

const HUB_URL = process.env['HUB_URL'] || "nemes.farcaster.xyz:2283"
const client = getSSLHubRpcClient(HUB_URL);

export async function GET(req: NextRequest) {
    if (req.method === 'POST') {
        // Process the vote
        // For example, let's assume you receive an option in the body
        try {
            const { searchParams } = new URL(req.url)
            const pollId = searchParams.get('id')
            const results = searchParams.get('results') === 'true'
            let voted = searchParams.get('voted') === 'true'
            if (!pollId) {
                return new NextResponse(JSON.stringify({ message: 'Missing poll ID' }), { status: 400 })
            }

            let validatedMessage : Message | undefined = undefined;
            try {
                const body = await req.json()
                const frameMessage = Message.decode(Buffer.from(body?.trustedData?.messageBytes || '', 'hex'))
                const result = await client.validateMessage(frameMessage);
                if (result.isOk() && result.value.valid) {
                    validatedMessage = result.value.message;
                }
            } catch (e)  {
                return new NextResponse(JSON.stringify({ message: `Failed to validate message: ${e}` }), { status: 400 })
            }

            const buttonId = validatedMessage?.data?.frameActionBody?.buttonIndex || 0;
            const fid = validatedMessage?.data?.fid || 0;
            const votedOption = await kv.hget(`poll:${pollId}:votes`, `${fid}`)
            voted = voted || !!votedOption

            if (buttonId > 0 && buttonId < 5 && !results && !voted) {
                let multi = kv.multi();
                multi.hincrby(`poll:${pollId}`, `votes${buttonId}`, 1);
                multi.hset(`poll:${pollId}:votes`, {[fid]: buttonId});
                await multi.exec();
            }

            let poll: Poll | null = await kv.hgetall(`poll:${pollId}`);

            if (!poll) {
                return new NextResponse(JSON.stringify({ message: 'Missing poll ID' }), { status: 400 })
            }
            const imageUrl = `${process.env.NEXT_PUBLIC_HOST}/api/image?id=${poll.id}&results=${results ? 'false': 'true'}&date=${Date.now()}${ fid > 0 ? `&fid=${fid}` : '' }`;
            // const imageUrl = `${process.env.NEXT_PUBLIC_HOST}/api/image?id=${poll.id}&results=${results ? 'false': 'true'}${ fid > 0 ? `&fid=${fid}` : '' }`;
            let button1Text = "View Results";
            if (!voted && !results) {
                button1Text = "Back"
            } else if (voted && !results) {
                button1Text = "Already Voted"
            } else if (voted && results) {
                button1Text = "View Results"
            }

            // Return an HTML response
            const htmlResponse = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Vote Recorded</title>
                    <meta property="og:title" content="Vote Recorded">
                    <meta property="og:image" content="${imageUrl}">
                    <meta name="fc:frame" content="vNext">
                    <meta name="fc:frame:image" content="${imageUrl}">
                    <meta name="fc:frame:post_url" content="${process.env.NEXT_PUBLIC_HOST}/api/vote?id=${poll.id}&voted=true&results=${results ? 'false' : 'true'}">
                    <meta name="fc:frame:button:1" content="${button1Text}">
                </head>
                <body>
                    <p>${ results || voted ? `You have already voted ${votedOption}` : `Your vote for ${buttonId} has been recorded for fid ${fid}.` }</p>
                </body>
                </html>
            `

            return new NextResponse(htmlResponse, { 
                status: 200, 
                headers: {
                    'Content-Type': 'text/html',
                }
            })

        } catch (error) {
            console.error(error);
            return new NextResponse(JSON.stringify({ message: 'Error generating image' }), { status: 500 })
        }
    } else {
        // Handle any non-POST requests
        const response = new NextResponse(`Method ${req.method} Not Allowed`, { status: 405 })
        response.headers.set('Allow', 'POST')
        return response
    }
}
