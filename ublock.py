from selenium import webdriver, common
from selenium.webdriver.common.keys import Keys
import time
from pyvirtualdisplay import Display


class UblockProcessUrl(object):
    """docstring for UblockProcessUrl"""
    def __init__(self):
        super(UblockProcessUrl, self).__init__()
        self.display = Display(visible=0, size=(2880, 1800)).start()
        self.extension_uri = "chrome-extension://cjpalhdlnbpafiamejdnhcphjbkeiagm/logger-ui.html?popup=1#_"
        
    def UblockProcessUrl(self,driver,new_url,wait=3):
        driver.maximize_window()
        driver.get(self.extension_uri)
        driver.execute_script('window.open("")')
        driver.switch_to.window(driver.window_handles[1])
        driver.get(new_url)
        time.sleep(wait)
        driver.switch_to.window(driver.window_handles[0])
        try:
            driver.find_element_by_css_selector('#loggerExport').click()
            data = driver.find_element_by_css_selector("#loggerExportDialog > textarea").get_attribute('value')
            driver.switch_to.window(driver.window_handles[1])
            driver.execute_script("window.close()")
            driver.switch_to.window(driver.window_handles[0])
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

        

    