import unittest
from unittest.mock import patch
import numpy as np
from lead_ocr import read_labels


def data(name='',x=0,y=0,w=0,h=0):
    return {'text':[name], 'conf':[95], 'left':[x], 'top':[y], 'width':[w], 'height':[h]}


class CoordinateTests(unittest.TestCase):
    def test_rotated_boxes_map_back_to_input(self):
        image=np.zeros((800,1200),np.uint8)
        for index,angle,expected in [(0,0,[100,200,30,12]),(1,90,[200,670,12,30]),
                                     (2,270,[988,100,12,30]),(3,180,[1070,588,30,12])]:
            responses=[data() for _ in range(7)]
            responses[index]=data('V1',100,200,30,12)
            with patch('pytesseract.image_to_data',side_effect=responses):
                result=read_labels(image)
            self.assertEqual(result['rotation_degrees'],angle)
            self.assertEqual(result['coordinate_space'],'input_pixels')
            self.assertEqual(result['detections'][0]['box'],expected)

    def test_upscaled_coordinates_and_height_return_to_original_pixels(self):
        responses=[data('V1',100,200,30,12)]+[data() for _ in range(4)]+[data('V2',200,400,60,24),data()]
        with patch('pytesseract.image_to_data',side_effect=responses):
            result=read_labels(np.zeros((800,1200),np.uint8))
        self.assertEqual(result['detections'][1]['box'],[100,200,30,12])
        self.assertEqual(result['detections'][1]['height'],12)

if __name__=='__main__': unittest.main()
