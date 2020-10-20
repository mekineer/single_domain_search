from selenium import webdriver, common
from selenium.webdriver.common.keys import Keys
import time
from pyvirtualdisplay import Display


class UblockProcessUrl(object):
    """docstring for UblockProcessUrl"""
    def __init__(self):
        super(UblockProcessUrl, self).__init__()
        self.display = Display(visible=0, size=(2880, 1800)).start()
        chrome_options = webdriver.ChromeOptions()
        # chrome_options.add_argument('--headless')
        chrome_options.add_extension('ubo_1_30_4_0.crx')
        self.driver = webdriver.Chrome(executable_path="./chromedriver",options=chrome_options)
        self.driver.maximize_window()
        self.extension_uri = "chrome-extension://cjpalhdlnbpafiamejdnhcphjbkeiagm/logger-ui.html?popup=1#_"
        
    def UblockProcessUrl(self,new_url,wait=3):
        self.driver.get(self.extension_uri)
        self.driver.execute_script('window.open("")')
        self.driver.switch_to.window(self.driver.window_handles[1])
        self.driver.get(new_url)
        time.sleep(wait)
        self.driver.switch_to.window(self.driver.window_handles[0])
        try:
            self.driver.find_element_by_css_selector('#loggerExport').click()
            data = self.driver.find_element_by_css_selector("#loggerExportDialog > textarea").get_attribute('value')
            self.driver.switch_to.window(self.driver.window_handles[1])
            self.driver.execute_script("window.close()")
            self.driver.switch_to.window(self.driver.window_handles[0])
        except Exception as msg:
            print(msg)
            data = ''
        data = data.splitlines()
        urls = set()
        for i in data:
            if i.startswith("http"):
                urls.add(i.strip())
        print(urls)
        return list(urls)
