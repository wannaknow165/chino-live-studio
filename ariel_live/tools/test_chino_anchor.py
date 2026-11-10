import unittest
import numpy as np
from chino_anchor import comb

class CombTrackingTests(unittest.TestCase):
    def frame(self):
        frame=np.full((200,100,4),255,dtype=np.uint8)
        return frame

    def test_saturated_crest_separates_connected_reddish_face(self):
        first=self.frame(); first[75:90,45:55,:3]=[230,20,40]
        second=self.frame(); second[95:110,45:55,:3]=[230,20,40]
        second[110:190,35:65,:3]=[220,130,130]
        points=comb(np.stack([first,second]),100,200)
        self.assertIsNotNone(points[1])
        self.assertAlmostEqual(points[1][1],102/200,places=3)
        self.assertLess(points[1][1],.55)

    def test_primary_observed_crest_is_unchanged(self):
        first=self.frame(); first[25:45,45:55,:3]=[230,20,40]
        first[130:160,35:65,:3]=[220,130,130]
        point=comb(np.stack([first]),100,200)[0]
        self.assertAlmostEqual(point[0],49.5/100)
        self.assertAlmostEqual(point[1],34.5/200)

    def test_offscreen_crest_is_not_replaced_by_tiny_red_noise(self):
        first=self.frame(); first[25:45,45:55,:3]=[230,20,40]
        second=self.frame(); second[190:194,40:44,:3]=[230,20,40]
        points=comb(np.stack([first,second]),100,200)
        self.assertIsNone(points[1])

if __name__=='__main__': unittest.main()
