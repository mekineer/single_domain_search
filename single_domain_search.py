#!/usr/bin/env python
# -*- coding: utf-8 -*-'
import urllib
from pathlib import Path
import tldextract
from selenium import webdriver
import time
from googlesearch import search
import json
import os
import logging

logger = logging.getLogger("cdn")
logger.setLevel(logging.DEBUG)
logging.basicConfig(
    filemode="w",
    filename="scdn.log",
    format="[%(asctime)s][%(levelname)s]: %(message)s"
)


class Stats:
    processed = 0
    found_urls = set()
    visited_urls = set()


stats = Stats()


class D2O:
    def __init__(self, **entries):
        self.__dict__.update(entries)


def found_success(original_url, urls):
    extracted = tldextract.extract(original_url)
    original_host = "{}.{}".format(extracted.domain, extracted.suffix)
    for u in urls:
        sextract = tldextract.extract(u)
        sub_host = "{}.{}".format(sextract.domain, sextract.suffix)
        logger.debug(f"orig: {original_host}, sub: {sub_host}")
        if original_host != sub_host and sub_host not in white_list_domains:
            return False

    return True


def find_urls(netjson):
    a = []
    for i in netjson:
        if "connectStart" in i:
            a.append(i["name"])
    return a


def get_src_urls(driver):
    srcs = []
    tags = ['iframe', 'script']
    for t in tags:
        elems = driver.find_elements_by_tag_name(t)
        for e in elems:
            s = e.get_attribute("src")
            if s:
                srcs.append(s)
    return srcs


def get_extracted_urls(url):
    # chrome
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_argument("--ignore-certificate-errors")
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument("--enable-javascript")
    driver = webdriver.Chrome(executable_path="util/mac_os/chromedriver",
                              options=chrome_options)
    print(url)
    logger.debug(f"processing url: {url}")
    driver.get(url)
    time.sleep(config_data.page_delay)
    script_to_exec = "var performance = window.performance || window.mozPerformance || window.msPerformance || window.webkitPerformance || {}; var network = performance.getEntries() || {}; return network;";
    net_stat = driver.execute_script(script_to_exec)

    if config_data.save_htmls:
        Path("htmls").mkdir(parents=True, exist_ok=True)
        url_html_file = urllib.parse.quote(url, safe='')
        with open(f'htmls/{url_html_file}.html', 'w', encoding="utf-8") as f:
            f.write(driver.page_source)

    extracted_urls = list(set(find_urls(net_stat)))
    extracted_urls += get_src_urls(driver)
    logger.debug(f"extracted urls: {extracted_urls}")
    driver.quit()
    return extracted_urls


if __name__ == '__main__':
    CONFIG_PATH = os.environ.get("CONF", "param.json")
    logger.debug(f"loading config from path: {CONFIG_PATH}")

    with open(CONFIG_PATH, "r") as cf:
        config_data = D2O(**json.loads(cf.read()))

    limit_urls = config_data.batch_limit
    query = config_data.query
    pause_delay = config_data.pause_delay
    desired_count = config_data.desired_count
    output_path = config_data.output_file
    white_list_domains = config_data.whitelist
    logger.debug(f"whitelist: {white_list_domains}")

    optional_config = config_data.optional
    start_num = 0

    cd_min = optional_config.get('min_date', '') or '1/1/1500'
    cd_max = optional_config.get('max_date', '') or '1/1/3000'
    tld = optional_config.get('tld', '') or 'com'
    safe = optional_config.get('safe', '') or 'off'
    lang = optional_config.get('lang', '') or 'en'
    try:
        while True:
            stop_num = start_num + limit_urls
            search_params = {
                "num": limit_urls,
                "start": start_num,
                "stop": stop_num,
                "pause": pause_delay,
                "tbs": f"cdr:1,cd_min:{cd_min},cd_max:{cd_max}",
                "tld": tld,
                "lang": lang,
                "safe": safe,
                "country": optional_config.get('country', ''),
                "verify_ssl": False,
                "query": query
            }

            search_urls = []
            logger.debug(f"searching google with params: {search_params}")
            for u in search(**search_params):
                search_urls.append(u)

            new_urls = []
            for i in search_urls:
                if i not in stats.visited_urls:
                    new_urls.append(i)

            print(f"new urls recieved from google: {len(new_urls)}")
            logger.debug(f"new urls recieved from google: {len(new_urls)}")
            if len(new_urls) < 1:
                print("No new urls recieved: Exiting")
                exit(1)

            start_num += limit_urls
            for url in new_urls:
                if url not in stats.visited_urls:
                    stats.processed += 1
                    logger.debug(f"total urls processed: {stats.processed}")
                    stats.visited_urls.add(url)

                    ext_urls = get_extracted_urls(url)
                    if found_success(url, ext_urls):
                        stats.found_urls.add(url)
                        logger.debug(f"FOUND DESIRED URL: {url}")

                        with open(output_path, 'a') as of:
                            of.write(f"{url}\n")
                            of.flush()

                        print(f"***************** FOUND URLS: {stats.found_urls}")
                        if len(stats.found_urls) == desired_count:
                            print(f"Found desired count of urls: {desired_count}")
                            exit(0)
    except Exception as e:
        logger.exception(e)
        print(f"[ERROR] Something went wrong. Please check scdn.log. . . {e} Exiting")
