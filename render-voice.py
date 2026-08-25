import sys
import json
import asyncio
import os
import edge_tts

VOICE_MAP = {
    "Friendly Male": "en-US-GuyNeural",
    "Friendly Female": "en-US-JennyNeural",
    "Deep Male": "en-US-DavisNeural",
    "Warm Female": "en-US-AriaNeural",
    "Energetic Male": "en-GB-RyanNeural",
    "Calm Female": "en-GB-SoniaNeural",
}

async def main():
    job_id = sys.argv[1]
    prompt_data = json.loads(sys.argv[2])

    text = prompt_data.get("text", prompt_data.get("query", "Hello from MotionBloom."))
    voice_label = prompt_data.get("voice", "Friendly Female")
    voice_id = VOICE_MAP.get(voice_label, "en-US-JennyNeural")

    print(f"Job: {job_id}, Voice: {voice_label} ({voice_id})")
    print(f"Text length: {len(text)} chars")

    os.makedirs("output", exist_ok=True)
    output_path = os.path.join("output", f"{job_id}.mp3")

    communicate = edge_tts.Communicate(text, voice_id)
    await communicate.save(output_path)

    print(f"Render complete: {output_path}")

if __name__ == "__main__":
    asyncio.run(main())
