from selenium import webdriver, common
# from seleniumwire import webdriver  # https://stackoverflow.com/questions/15645093/setting-request-headers-in-selenium
from selenium.webdriver.remote.command import Command
import time
from pyvirtualdisplay import Display
import socket
import http.client as httplib

class CustomDriver(object):
	"""docstring for CustomDriver"""
	def __init__(self):
		super(CustomDriver, self).__init__()
		# self.display = Display(visible=0, size=(2880, 1800)).start()
		self.driver = None
		self.prepareDriver()
	
	def prepareDriver(self):
		chrome_options = webdriver.ChromeOptions()
		# chrome_options.add_argument('--headless')
        chrome_options.add_extension('ubo_1_30_4_0.crx')
		chrome_options.add_argument("--load-extension=1.30.2_0")
		chrome_options.add_argument("--ignore-certificate-errors")
		chrome_options.add_argument('--no-sandbox')
		chrome_options.add_argument('--disable-gpu')
		chrome_options.add_argument("--enable-javascript")
		chrome_options.add_argument("--disable-chrome-google-url-tracking-client")
#		chrome_options.add_argument("--disable-web-security")
#		chrome_options.add_argument("--disable-extensions")
		chrome_options.add_argument("--safebrowsing-disable-download-protection")
		chrome_options.add_argument("--disable-domain-reliability")
		chrome_options.add_argument("--allow-running-insecure-content")
		chrome_options.add_argument("--unsafely-treat-insecure-origin-as-secure=http://host:port")
		chrome_options.add_argument('--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.92 Safari/537.36')
		self.driver = webdriver.Chrome(executable_path="./chromedriver",options=chrome_options)
		self.driver.maximize_window()
		self.driver.header_overrides = {
		'Referer': 'com.google.android.gm',
		}

	def getDriver(self):
		if not self.driver:
			self.driver = prepareDriver()
		else:
			try:
				self.driver.execute(Command.STATUS)
			except (socket.error, httplib.CannotSendRequest):
				self.driver = prepareDriver()
		return self.driver