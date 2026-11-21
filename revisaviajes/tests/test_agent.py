import unittest
from unittest.mock import patch
import agent
class Tests(unittest.TestCase):
    def test_private_blocked(self):
        for ip in ['127.0.0.1','10.0.0.1','169.254.169.254','::1']:
            with patch('socket.getaddrinfo',return_value=[(None,None,None,None,(ip,443))]):
                with self.assertRaises(ValueError): agent.public_address('example.test')
    def test_text(self):
        self.assertEqual(agent.extract(b'Hola','a.txt'),'Hola')
    def test_html_rejected(self):
        with self.assertRaises(ValueError): agent.extract(b'<html>Login</html>','/file')
    def test_good_evidence(self):
        r={'summary':'x','findings':[{'evidence':[{'source_id':'D01','quote':'hotel'}]}],
           'coverage':[{'check':c} for c in agent.CHECKS],'consistent_services':[],'limitations':[]}
        self.assertIs(agent.validate_report(r,[{'source_id':'D01','text':'hotel confirmado'}]),r)
        r['findings'][0]['evidence'][0]['quote']='inventado'
        with self.assertRaises(ValueError): agent.validate_report(r,[{'source_id':'D01','text':'hotel confirmado'}])
    def test_evidence_locations_keep_all_occurrences_in_the_cited_document(self):
        report = {'findings': [{'evidence': [{'source_id': 'D01', 'quote': 'hotel\nconfirmado'}]}]}
        docs = [
            {'source_id': 'D01', 'name': 'reserva.txt', 'sha256': 'fixture',
             'text': 'Reserva\nhotel\nconfirmado\nhotel\nconfirmado'},
            {'source_id': 'D02', 'name': 'plan.txt', 'sha256': 'other',
             'text': 'hotel\nconfirmado'},
        ]
        agent.add_evidence_locations(report, docs)
        location = report['findings'][0]['evidence'][0]['location']
        self.assertEqual(location, {
            'document': 'reserva.txt',
            'sha256': 'fixture',
            'occurrences': [{'line_start': 2, 'line_end': 3},
                            {'line_start': 4, 'line_end': 5}],
        })

    def test_duplicate_coverage_is_invalid(self):
        checks = [{'check': check} for check in agent.CHECKS]
        report = {'summary': 'x', 'findings': [], 'coverage': checks + checks[:1],
                  'consistent_services': [], 'limitations': []}
        with self.assertRaises(ValueError):
            agent.validate_report(report, [])

    def test_escape(self):
        self.assertNotIn('<script>',agent.render({'x':'<script>'}))
if __name__=='__main__': unittest.main()
