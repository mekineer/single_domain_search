
import sys
sys.path.extend(['/Library/Frameworks/Python.framework/Versions/3.8/lib/python38.zip', '/Library/Frameworks/Python.framework/Versions/3.8/lib/python3.8', '/Library/Frameworks/Python.framework/Versions/3.8/lib/python3.8/lib-dynload', '/Library/Frameworks/Python.framework/Versions/3.8/lib/python3.8/site-packages'])
import numpy

from datetime import datetime
import json
import logging
import os
import time
import urllib
from pathlib import Path

import tldextract
from googlesearch import search
from selenium import webdriver, common
from db_controller import DBController
import requests