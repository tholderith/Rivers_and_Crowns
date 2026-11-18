# Generate a music track with Google Lyria 3 through OpenRouter (key from the network proxy).
# Usage: python3 tools/gen_music.py "<prompt>" out.mp3   (full song $0.08; clips: model google/lyria-3-clip-preview, $0.04)
import json, sys, base64, urllib.request, time
def gen(prompt, out, model='google/lyria-3-pro-preview'):
    body={"model":model,"modalities":["text","audio"],"audio":{"format":"mp3"},"stream":True,
          "messages":[{"role":"user","content":prompt}]}
    req=urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',data=json.dumps(body).encode(),
        headers={'Authorization':'Bearer proxy-injected','Content-Type':'application/json'})
    t=time.time(); chunks=[]; text=[]; usage=None; fmt=None
    with urllib.request.urlopen(req,timeout=600) as r:
        for line in r:
            line=line.decode().strip()
            if not line.startswith('data:'): continue
            data=line[5:].strip()
            if data=='[DONE]': break
            j=json.loads(data)
            if j.get('usage'): usage=j['usage']
            for c in j.get('choices',[]):
                d=c.get('delta',{})
                a=d.get('audio') or {}
                if a.get('data'): chunks.append(a['data'])
                if a.get('format'): fmt=a['format']
                if a.get('transcript'): text.append(a['transcript'])
                if d.get('content'): text.append(d['content'])
    raw=base64.b64decode(''.join(chunks)) if chunks else b''
    open(out,'wb').write(raw)
    return len(raw), round(time.time()-t), (usage or {}).get('cost'), fmt, ''.join(text)[:300]
if __name__=='__main__':
    print(gen(sys.argv[1], sys.argv[2]))
