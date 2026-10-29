import copy,json,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from local_review import load_local, review_local
class LocalTests(unittest.TestCase):
    def setUp(self): self.data=json.loads(Path('examples/local_correcto.json').read_text())
    def test_clean(self): self.assertEqual(review_local(self.data)['findings'],[])
    def test_bad(self):
        self.assertCountEqual([f['code'] for f in load_local('examples/local_con_errores.json')['findings']],['DATE_CONFLICT','NIGHT_GAP','OVERLAP','CONFIRMATION'])
    def test_adjacent(self):
        self.data['events'][1].update(start='2027-05-13T12:00:00+01:00',end='2027-05-13T13:00:00+01:00')
        self.assertNotIn('OVERLAP',[f['code'] for f in review_local(self.data)['findings']])
    def test_timezone(self):
        self.data['events'][0]['start']='2027-05-13T09:00:00'
        with self.assertRaises(ValueError): review_local(self.data)
    def test_short_margin(self):
        self.data['events'][1]['required_margin_minutes']=180
        self.assertIn('SHORT_MARGIN',[f['code'] for f in review_local(self.data)['findings']])
    def test_missing_end(self):
        del self.data['events'][0]['end']
        self.assertIn('MISSING_END',[f['code'] for f in review_local(self.data)['findings']])
    def test_duplicate_id(self):
        self.data['events'][0]['id']='hotel'
        with self.assertRaises(ValueError): review_local(self.data)
    def test_cli_offline(self):
        import agent
        with tempfile.TemporaryDirectory() as dest, patch('socket.create_connection',side_effect=AssertionError('Red prohibida')),patch('agent.review',side_effect=AssertionError('API prohibida')),patch.object(sys,'argv',['agent.py','examples/local_correcto.json','--out',dest]):
            agent.main()
            self.assertEqual(json.loads((Path(dest)/'informe.json').read_text())['mode'],'local_offline')
if __name__=='__main__': unittest.main()
