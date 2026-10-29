"""Motor determinista offline. Solo biblioteca estándar."""
from datetime import date, datetime, timedelta
from itertools import combinations
import json

def review_local(data):
    if not isinstance(data, dict): raise ValueError('El expediente debe ser un objeto JSON')
    trip=data['trip']; start=date.fromisoformat(trip['start']); end=date.fromisoformat(trip['end'])
    if not 0 < (end-start).days <= 366: raise ValueError('Viaje: duración entre 1 y 366 noches')
    hotels=data['hotels']; events=data['events']
    if not isinstance(hotels,list) or not isinstance(events,list) or len(hotels)+len(events)>500:
        raise ValueError('Máximo 500 registros entre hotels y events')
    findings=[]; parsed=[]; coverage=set(); ids=set()
    def add(code,title,refs,detail):
        findings.append({'code':code,'title':title,'references':refs,'detail':detail})
    for group,items in [('hotels',hotels),('events',events)]:
        for i,x in enumerate(items):
            ref=f'/{group}/{i}'
            if not isinstance(x,dict) or not isinstance(x.get('id'),str) or not x['id'] or x['id'] in ids:
                raise ValueError(f'{ref}: id obligatorio, único y de texto')
            ids.add(x['id'])
            if x.get('confirmed') not in (True,False,None) or (x.get('confirmed') is not None and type(x['confirmed']) is not bool):
                raise ValueError(f'{ref}: confirmed debe ser true, false o null')
            if x.get('confirmed') is not True:
                add('CONFIRMATION',f"Confirmación pendiente: {x['id']}",[ref],
                    'No consta confirmación en los datos; esto no demuestra que no exista reserva.')
            if group=='hotels':
                a=date.fromisoformat(x['check_in']); b=date.fromisoformat(x['check_out'])
                if b<=a: raise ValueError(f'{ref}: check_out debe ser posterior a check_in')
                if x.get('confirmed') is True:
                    coverage.update(a+timedelta(days=n) for n in range(max(0,(start-a).days), min((b-a).days,(end-a).days)))
            else:
                a=datetime.fromisoformat(x['start']); raw=x.get('end'); b=datetime.fromisoformat(raw) if raw else None
                if a.utcoffset() is None or (b and b.utcoffset() is None):
                    raise ValueError(f'{ref}: fechas con zona UTC explícita, por ejemplo +01:00')
                if b and b<=a: raise ValueError(f'{ref}: end debe ser posterior a start')
                if not start<=a.date()<=end:
                    add('OUTSIDE_TRIP',f"Evento fuera del viaje: {x['id']}",[ref,'/trip'],'Fecha local fuera del intervalo declarado.')
                if not b:
                    add('MISSING_END',f"Falta hora final: {x['id']}",[ref],'No se puede comprobar todo el intervalo de este evento.')
                parsed.append((x,a,b,ref))
            expected=x.get('planned_start')
            actual=x.get('check_in') if group=='hotels' else x.get('start')
            if expected:
                p=date.fromisoformat(expected) if group=='hotels' else datetime.fromisoformat(expected)
                q=date.fromisoformat(actual) if group=='hotels' else datetime.fromisoformat(actual)
                if group=='events' and p.utcoffset() is None: raise ValueError(f'{ref}: planned_start necesita zona UTC')
                if p!=q: add('DATE_CONFLICT',f"Fecha/hora contradictoria: {x['id']}",[ref],f'Plan: {expected}; documento: {actual}. Resolver manualmente sin elegir una fuente.')
    for n in range((end-start).days):
        night=start+timedelta(days=n)
        if night not in coverage:
            add('NIGHT_GAP',f'Noche sin alojamiento confirmado documentado: {night}', ['/trip','/hotels'],
                'No está cubierta por los intervalos confirmados aportados. Puede existir una reserva no documentada.')
    for (x,a,b,r),(y,c,d,s) in combinations(parsed,2):
        if b and d and a<d and c<b:
            add('OVERLAP',f"Solapamiento: {x['id']} / {y['id']}",[r,s],'Los intervalos se superponen; comprueba si deben ser simultáneos o si hay que reprogramarlos.')
    for x,a,b,ref in parsed:
        target=x.get('must_arrive_by'); minutes=x.get('required_margin_minutes')
        if target is not None:
            t=datetime.fromisoformat(target)
            if t.utcoffset() is None: raise ValueError(f'{ref}: must_arrive_by necesita zona UTC')
            if minutes is not None and (type(minutes) is not int or minutes<0):
                raise ValueError(f'{ref}: margen debe ser entero no negativo')
            if b is None or minutes is None:
                add('UNKNOWN_MARGIN',f"Margen no evaluable: {x['id']}",[ref],'Falta llegada o margen requerido documentado.')
            elif b+timedelta(minutes=minutes)>t:
                add('SHORT_MARGIN',f"Margen insuficiente: {x['id']}",[ref],f'Llegada {b.isoformat()}, objetivo {target}, margen requerido {minutes} minutos.')
    return {'mode':'local_offline','summary':f'{len(findings)} hallazgos para revisión humana',
        'findings':findings,'limitations':[
        'Revisión del JSON introducido; no interpreta PDF, Word ni enlaces en este modo.',
        'Referencias JSON pointer al archivo de entrada, no evidencia contrastada con documentos originales.',
        'No verifica reservas, rutas, check-in, visados, precios ni documentos externos.',
        'Los solapamientos requieren juicio humano; no se distinguen grupos de viajeros.',
        'Cobertura nocturna basada en fechas locales declaradas; viajes nocturnos y cambio de fecha requieren revisión manual.']}

def load_local(path):
    from pathlib import Path
    p=Path(path)
    if p.stat().st_size>2*1024*1024: raise ValueError('JSON local: máximo 2 MiB')
    return review_local(json.loads(p.read_text(encoding='utf-8-sig')))
