"""Conservative PDF extractors. Unsupported layouts return no fabricated rows."""
from __future__ import annotations
import re
from pathlib import Path
import pandas as pd
import pdfplumber
from data_utils import parse_timing_seconds


def extract_pdf_text(path: Path) -> str:
    with pdfplumber.open(path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def extract_leader_sequence(path: Path, session: str) -> pd.DataFrame:
    text = extract_pdf_text(path)
    match = re.search(r"No Driver Team Car Lap Lap Laps Laps\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", text)
    if not match:
        return pd.DataFrame(columns=["session", "lap_number", "leader_driver_id"])
    _, driver, start, end, total, _ = map(int, match.groups())
    if start != 1 or total != end:
        return pd.DataFrame(columns=["session", "lap_number", "leader_driver_id"])
    return pd.DataFrame({"session": session, "lap_number": range(start, end + 1), "leader_driver_id": driver})


def extract_lap_chart(path: Path, session: str) -> pd.DataFrame:
    rows=[]
    with pdfplumber.open(path) as pdf:
        for page_number,page in enumerate(pdf.pages,1):
            words=page.extract_words(); by_y={}
            for word in words:
                if word['top'] >= 208: by_y.setdefault(round(word['top']),[]).append(word)
            for words_row in by_y.values():
                words_row.sort(key=lambda w:w['x0'])
                if len(words_row)<3 or not (64 <= words_row[0]['x0'] <= 72 and 80 <= words_row[1]['x0'] <= 90): continue
                try: position=int(words_row[1]['text'])
                except ValueError: continue
                cells=[w for w in words_row if w['x0']>=114 and w['x0']<355]
                for index,cell in enumerate(cells,1):
                    try: driver=int(cell['text'])
                    except ValueError: continue
                    rows.append({'session':session,'lap_number':index,'driver_id':driver,'position':position,'source_page':page_number})
    return pd.DataFrame(rows,columns=['session','lap_number','driver_id','position','source_page'])


def extract_best_sectors(path: Path, session: str) -> pd.DataFrame:
    sector_maps=[{}, {}, {}]; laps={}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            by_y={}
            for w in page.extract_words():
                if w['top']>=212: by_y.setdefault(round(w['top']),[]).append(w)
            for row in by_y.values():
                row.sort(key=lambda w:w['x0'])
                def pick(lo,hi): return [w['text'] for w in row if lo<=w['x0']<hi]
                for i,(lo,hi,time_lo,time_hi) in enumerate([(76,120,130,165),(170,220,225,255),(264,315,320,350)]):
                    ids=pick(lo,hi); times=pick(time_lo,time_hi)
                    if ids and times:
                        try: sector_maps[i][int(ids[0])]=parse_timing_seconds(times[-1])
                        except ValueError: pass
                ids=pick(372,430); ideal=pick(475,515); best=pick(515,555)
                if ids:
                    try: laps[int(ids[0])]=(parse_timing_seconds(ideal[-1]) if ideal else None,parse_timing_seconds(best[-1]) if best else None)
                    except ValueError: pass
    drivers=sorted(set().union(*[set(x) for x in sector_maps],set(laps)))
    return pd.DataFrame([{'session':session,'driver_id':d,'best_sector1_seconds':sector_maps[0].get(d),'best_sector2_seconds':sector_maps[1].get(d),'best_sector3_seconds':sector_maps[2].get(d),'ideal_lap_seconds':laps.get(d,(None,None))[0],'best_lap_seconds':laps.get(d,(None,None))[1]} for d in drivers])


def extract_analysis_by_lap(path: Path, session: str, analysis: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Reject ambiguous multi-column text order rather than infer lap assignments."""
    candidates=[]; rejected=[]; row_id=0
    with pdfplumber.open(path) as pdf:
        for page_number,page in enumerate(pdf.pages,1):
            words=page.extract_words(); bands=[(60,155),(165,260),(270,365),(375,470),(480,575)]
            for band,(left,right) in enumerate(bands):
                block=sorted([w for w in words if left<=w['x0']<right],key=lambda w:w['top'])
                lap=None
                for w in block:
                    if w['text']=='Lap': continue
                    if w['text'].isdigit() and any(x['text']=='Lap' and abs(x['top']-w['top'])<3 for x in block): lap=int(w['text']); continue
                    if lap is None: continue
                    same=[x for x in block if abs(x['top']-w['top'])<2]
                    if w != min(same,key=lambda x:x['x0']): continue
                    texts=[x['text'] for x in sorted(same,key=lambda x:x['x0'])]
                    if len(texts)>=2 and texts[0].isdigit() and ':' in texts[1]:
                        row_id+=1; gap=parse_timing_seconds(texts[2]) if len(texts)>2 else None
                        candidates.append({'session':session,'pdf_row_id':f'{session}_{page_number}_{band}_{row_id}','driver_id':int(texts[0]),'lap_time_seconds':parse_timing_seconds(texts[1]),'gap_to_leader_seconds':gap,'source_page':page_number,'pdf_lap_label':lap})
    accepted=[]
    for row in candidates:
        matches=analysis[(analysis.session==session)&(analysis.driver_id==row['driver_id'])&(analysis.lap_time_seconds.sub(row['lap_time_seconds']).abs()<0.0005)] if analysis is not None else pd.DataFrame()
        if len(matches)==1: accepted.append({**row,'lap_number':int(matches.lap_number.iloc[0])})
        else: rejected.append({'session':session,'pdf_row_id':row['pdf_row_id'],'driver_id':row['driver_id'],'lap_time_seconds':row['lap_time_seconds'],'candidate_laps':' | '.join(map(str,matches['lap_number'].tolist())) if 'lap_number' in matches else '','reason':'no unique Analysis CSV driver/lap-time match'})
    accepted = pd.DataFrame(accepted,columns=['session','pdf_row_id','driver_id','lap_number','lap_time_seconds','gap_to_leader_seconds','source_page','pdf_lap_label'])
    rejected = pd.DataFrame(rejected,columns=['session','pdf_row_id','driver_id','lap_time_seconds','candidate_laps','reason'])
    return accepted, rejected


def extract_classification_pdf(path: Path, session: str) -> pd.DataFrame:
    return pd.DataFrame(columns=["session", "driver_id", "position"])


def extract_fastest_lap_sequence(path: Path, session: str) -> pd.DataFrame:
    return pd.DataFrame(columns=["session", "lap_number", "driver_id", "lap_time_seconds"])
